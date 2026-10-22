"""Builds helpers/caRefreshData.json for the "CA Refresh" project from
  - the CA Refresh test-case workbook (Pre-condition column + Coverage Lists sheet)
  - the Donegal Commercial Auto product model (Coverages + Coverage Term Options sheets)

  python -I scripts/buildCaRefreshData.py "<test cases.xlsx>" "<product model.xlsx>"
Defaults to the V:\\Amit Int\\CARefresh copies. Offline; re-run whenever either workbook changes.
"""
import json, os, re, sys, warnings
import openpyxl

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r'V:\Amit Int\CARefresh'
TC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, 'ABP-1775_CA Refresh Docs - Batch 2.xlsx')
PM = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SRC, 'Donegal Commercial Auto Product Model _SBT_OCP_v1.0.xlsx')
OUT = os.path.join(HERE, '..', 'helpers', 'caRefreshData.json')


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s or '').lower()).strip()


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '').replace('\ufffd', '-')).strip()


# ── Test cases: id, LOB, states, precondition ────────────────────────────────
wb = openpyxl.load_workbook(TC, read_only=True)
ws = wb['CA Refresh Doc Upd - Batch1']
cases = []
for r in ws.iter_rows(min_row=2, values_only=True):
    if not r[0]:
        continue
    m = re.search(r'For States?:\s*([A-Z, ]+?),\s*Verify', str(r[1]))
    states = [s.strip() for s in m.group(1).split(',') if s.strip()] if m else []
    lob = 'AUTO_DEALERS' if 'Auto Dealers Policy' in str(r[1]) else 'BUSINESS_AUTO'
    cases.append({'id': str(r[0]), 'lob': lob, 'states': states, 'name': clean(r[1]), 'pre': str(r[3] or '')})


def parse_pre(pre):
    """Section -> [coverage names], plus the 'Additional Coverages from mapping' (forms) list."""
    sections, forms, cur, mapping = [], [], None, False
    for line in pre.splitlines():
        t = line.strip()
        if not t:
            continue
        if t.startswith('Coverages:'):
            continue
        if t.startswith('Additional Coverages from mapping'):
            mapping, cur = True, None
            continue
        if t.endswith(':-'):
            mapping = False
            cur = {'category': t[:-2].strip(), 'coverages': []}
            sections.append(cur)
            continue
        if mapping:
            forms.append(clean(t))
        elif cur is not None and t not in cur['coverages']:
            cur['coverages'].append(clean(t))
    return sections, forms


# ── Product model lookups ────────────────────────────────────────────────────
pm = openpyxl.load_workbook(PM, read_only=True)
cov_rows = list(pm['Coverages'].iter_rows(values_only=True, max_col=40))
hdr = cov_rows[1]
STATE_COLS = {hdr[i]: i for i in range(15, 39) if hdr[i]}
cov_index = {}
for r in cov_rows[2:]:
    if not r[4]:
        continue
    key = (norm(r[3]), norm(r[4]))
    cov_index[key] = r
    cov_index.setdefault((None, norm(r[4])), r)

opt_rows = list(pm['Coverage Term Options'].iter_rows(values_only=True, max_col=16))
terms = {}  # (category, coverage) -> {term: [options]}
for r in opt_rows[2:]:
    if not r[4] or not r[6]:
        continue
    t = terms.setdefault((norm(r[3]), norm(r[4])), {})
    if r[9]:
        t.setdefault(clean(r[6]), [])
        if clean(r[9]) not in t[clean(r[6])]:
            t[clean(r[6])].append(clean(r[9]))


def enrich(category, name):
    row = cov_index.get((norm(category), norm(name))) or cov_index.get((None, norm(name)))
    out = {'name': name}
    if row:
        out['code'] = row[5]
        out['form'] = clean(row[12]) or None
        out['writeBiz'] = clean(row[10]) or None  # Donegal WriteBiz Availability For Agents (Y/N)
        out['availability'] = {s: clean(row[i]) for s, i in STATE_COLS.items() if row[i] not in (None, '')}
    t = terms.get((norm(category), norm(name)))
    if not t and row:
        t = terms.get((norm(row[3]), norm(row[4])))
    if t:
        out['terms'] = t
    return out


# ── Coverage Lists sheet: the "Removed" column ───────────────────────────────
wb2 = openpyxl.load_workbook(TC, read_only=True)
removed, cur = [], None
for r in wb2['Coverage Lists'].iter_rows(min_row=4, values_only=True):
    t = clean(r[5]) if r[5] else ''
    if not t:
        continue
    if t.endswith(':-'):
        cur = t[:-2].strip()
    else:
        removed.append({'category': cur, 'name': t})

data = {
    'source': {'testCases': os.path.basename(TC), 'productModel': os.path.basename(PM)},
    'effective': {'IN': '2027-05-01', 'IL': '2027-05-01', 'default': '2027-08-01'},
    'lobs': {},
    'removed': removed,
}
for lob in ('BUSINESS_AUTO', 'AUTO_DEALERS'):
    mine = [c for c in cases if c['lob'] == lob]
    if not mine:
        continue
    sections, forms = parse_pre(mine[0]['pre'])
    identical = all(parse_pre(c['pre']) == (sections, forms) for c in mine)
    data['lobs'][lob] = {
        'testCases': {s: c['id'] for c in mine for s in c['states']},
        'testCaseNames': {c['id']: c['name'] for c in mine},
        'preconditionIdenticalAcrossStates': identical,
        'sections': [{'category': s['category'], 'coverages': [enrich(s['category'], n) for n in s['coverages']]} for s in sections],
        'mappingForms': forms,
    }
data['states'] = sorted({s for c in cases for s in c['states']})

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=1, ensure_ascii=False)
for lob, d in data['lobs'].items():
    n = sum(len(s['coverages']) for s in d['sections'])
    hit = sum(1 for s in d['sections'] for c in s['coverages'] if c.get('code'))
    print(f"{lob}: {len(d['testCases'])} states, {n} coverages ({hit} matched in product model), {len(d['mappingForms'])} forms, identical={d['preconditionIdenticalAcrossStates']}")
print('states:', ' '.join(data['states']), '| removed:', len(removed))
