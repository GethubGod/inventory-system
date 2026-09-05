#!/usr/bin/env python3
"""Build the local, self-contained mobile release report from recorded evidence."""
from pathlib import Path
import base64
import html
import json
import mimetypes

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'docs/release-readiness'

def esc(value):
    return html.escape(str(value), quote=True)

def badge(status):
    level = 'pass' if status == 'Pass' else 'fail' if status in ('Fail', 'Blocked') else 'review'
    return f'<span class="badge {level}">{esc(status)}</span>'

def table(headers, rows):
    return '<div class="table-scroll"><table><thead><tr>' + ''.join(f'<th>{esc(h)}</th>' for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{cell}</td>' for cell in row) + '</tr>' for row in rows) + '</tbody></table></div>'

def main():
    data = json.loads((REPORT / 'report-content.json').read_text())
    routes = json.loads((REPORT / 'route-inventory.json').read_text())
    checks = table(['Check', 'Result', 'Evidence and limits'], [
        [f'<code>{esc(c["command"])}</code>', badge(c['status']), esc(c['detail'])] for c in data['checks']
    ])
    changes = table(['Changed behavior', 'Reason and verification'], [
        [esc(c['title']), esc(c['detail'])] for c in data['changes']
    ])
    assumptions = table(['Decision', 'Reason', 'What remains to confirm'], [
        [esc(c['decision']), esc(c['reason']), esc(c['confirm'])] for c in data['assumptions']
    ])
    route_table = table(['Source route', 'Runtime coverage', 'Evidence'], [
        [f'<code>{esc(r["file"])}</code>', badge(r['status']), esc(', '.join(r.get('evidence', [])))] for r in routes
    ])
    screenshots = []
    for shot in data['screenshots']:
        path = (REPORT / shot['path']).resolve()
        if not path.is_relative_to(REPORT.resolve()):
            raise ValueError('Evidence image must be in the report directory')
        image = base64.b64encode(path.read_bytes()).decode('ascii')
        mime = mimetypes.guess_type(path.name)[0] or 'image/png'
        screenshots.append(f'<figure><button class="zoom" type="button" aria-label="Enlarge {esc(shot["title"])}"><img src="data:{mime};base64,{image}" alt="{esc(shot["caption"])}" loading="lazy"></button><figcaption><strong>{esc(shot["title"])}</strong><p>{esc(shot["caption"])}</p><code>{esc(shot["path"])}</code></figcaption></figure>')
    gallery = ''.join(screenshots) or '<p>No simulator screenshots were recorded. No visual pass is claimed.</p>'
    blockers = ''.join(f'<li><strong>{esc(x["title"])}</strong><p>{esc(x["detail"])}</p></li>' for x in data['blockers'])
    sources = ''.join(f'<li><a href="{esc(x["url"])}">{esc(x["title"])}</a>: {esc(x["detail"])}</li>' for x in data['sources'])
    files = ''.join(f'<li><code>{esc(p)}</code></li>' for p in data['files'])
    report = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Smelter mobile release report</title><style>
:root{{--ink:#142b3a;--muted:#536472;--paper:#f5f4ef;--line:#d8dedf;--red:#b53126;--green:#166549}}*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}header{{background:var(--ink);color:white;padding:60px max(24px,calc((100vw - 1120px)/2)) 44px}}header .eyebrow{{letter-spacing:.15em;font-size:12px;text-transform:uppercase;color:#c4d5dc}}h1{{font-size:clamp(32px,5vw,54px);line-height:1.08;margin:14px 0 22px;letter-spacing:-.04em}}header p{{max-width:820px;color:#dce5e9}}header code{{color:#fff}}main{{max-width:1168px;margin:auto;padding:28px 24px 80px}}nav{{display:flex;gap:18px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--line)}}a{{color:inherit;text-underline-offset:3px}}section{{margin-top:44px}}h2{{font-size:27px;line-height:1.25;letter-spacing:-.025em}}p{{margin:8px 0 16px}}.notice{{border-left:5px solid var(--red);padding:20px 24px;background:#fff2ed}}.notice h2{{margin-top:0;color:var(--red)}}.facts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:24px 0}}.fact{{padding:18px;background:white;border:1px solid var(--line);border-radius:10px}}.fact strong{{display:block;font-size:24px}}.fact span{{font-size:14px;color:var(--muted)}}table{{border-collapse:collapse;width:100%;font-size:14px;background:white}}th,td{{text-align:left;vertical-align:top;padding:14px 16px;border-bottom:1px solid var(--line)}}th{{background:#e7ecec;font-size:12px;text-transform:uppercase;letter-spacing:.06em}}.table-scroll{{overflow:auto;border:1px solid var(--line);border-radius:10px}}code{{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}}.badge{{display:inline-block;font-size:11px;font-weight:700;border-radius:4px;padding:3px 7px;white-space:nowrap}}.pass{{background:#e2f3e8;color:var(--green)}}.fail{{background:#fbe2dc;color:var(--red)}}.review{{background:#f5edcc;color:#755713}}.gallery{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;align-items:start}}figure{{margin:0;padding:15px;background:white;border:1px solid var(--line);border-radius:12px}}figure img{{display:block;width:100%;height:auto;max-height:630px;object-fit:contain;background:#eef0ef;border-radius:8px}}figcaption{{font-size:13px;padding:14px 0 2px}}figcaption p{{color:var(--muted)}}li{{margin-bottom:14px}}.zoom{{display:block;width:100%;border:0;padding:0;background:none;cursor:zoom-in}}dialog{{border:0;border-radius:12px;padding:18px;max-width:96vw;max-height:96vh;background:white}}dialog::backdrop{{background:#10202ee6}}dialog img{{display:block;width:min(660px,88vw);height:auto;max-width:88vw;object-fit:contain}}dialog button{{position:sticky;top:0;display:block;margin:0 0 12px auto;padding:10px 18px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);font:inherit;cursor:pointer}}.files{{columns:2;column-width:340px}}footer{{margin-top:50px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}}@media print{{header{{padding:25px}}main{{padding:15px}}nav{{display:none}}section{{break-inside:auto}}figure{{break-inside:avoid}}.table-scroll{{overflow:visible}}th,td{{padding:8px}}.gallery{{grid-template-columns:repeat(3,1fr)}}a{{text-decoration:none}}}}
</style></head><body><header><div class="eyebrow">Mobile release evidence · {esc(data['date'])}</div><h1>Smelter release readiness</h1><p>{esc(data['summary'])}</p><p><code>{esc(data['branch'])}</code><br>Base: <code>{esc(data['base'])}</code> · Tested code: <code>{esc(data['tested_commit'])}</code></p></header><main><nav><a href="#decision">Release decision</a><a href="#changes">Changes</a><a href="#checks">Checks</a><a href="#screenshots">Screenshots</a><a href="#assumptions">Assumptions</a><a href="#coverage">Every route</a><a href="#handoff">Handoff</a></nav>
<section id="decision" class="notice"><h2>{esc(data['verdict'])}</h2><p>{esc(data['verdict_detail'])}</p></section><div class="facts">{''.join(f'<div class="fact"><strong>{esc(f["value"])}</strong><span>{esc(f["label"])}</span></div>' for f in data['facts'])}</div>
<section><h2>Release blockers and remaining checks</h2><ol>{blockers}</ol></section>
<section id="changes"><h2>What changed</h2>{changes}</section>
<section id="checks"><h2>Commands and results</h2><p>Passing checks establish only the behavior described below. Skipped, blocked and partially exercised features remain visible.</p>{checks}</section>
<section id="screenshots"><h2>Actual simulator evidence</h2><p>{esc(data['screenshot_note'])}</p><div class="gallery">{gallery}</div></section>
<section id="assumptions"><h2>Decisions made on your behalf</h2>{assumptions}</section>
<section id="coverage"><h2>Complete screen-route inventory</h2><p>{len(routes)} non-layout screen routes discovered under app/. Route wrappers can share a screen. A screenshot proves only the state shown, not every mutation, role or error case.</p>{route_table}</section>
<section id="handoff"><h2>Files and handoff</h2><p>{esc(data['handoff'])}</p><ul class="files">{files}</ul><h2>Sources</h2><ul>{sources}</ul></section><footer>Prepared from local execution and recorded tool results. This document contains embedded screenshots and works offline. It is a test report, not an App Store approval certificate.</footer></main><dialog id="image-viewer" aria-label="Enlarged simulator screenshot"><button type="button" autofocus>Close screenshot</button><img alt=""></dialog><script>
const viewer = document.getElementById('image-viewer');
document.querySelectorAll('.zoom').forEach(button => button.addEventListener('click', () => {{
  const source = button.querySelector('img');
  const enlarged = viewer.querySelector('img');
  enlarged.src = source.src;
  enlarged.alt = source.alt;
  viewer.showModal();
}}));
viewer.querySelector('button').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', event => {{ if (event.target === viewer) viewer.close(); }});
</script></body></html>'''
    (REPORT / 'index.html').write_text(report)
    print(f'Wrote {REPORT / "index.html"} with {len(screenshots)} original evidence images and {len(routes)} route rows.')

if __name__ == '__main__':
    main()
