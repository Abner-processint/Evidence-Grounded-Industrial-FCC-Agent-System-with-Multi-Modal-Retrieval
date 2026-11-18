# -*- coding: utf-8 -*-
"""副本多轮核对：按会话时间对上执行编号，抽取（ctx_audit/fetch_audit.py），逐轮看：
存状态是否记了卡片、下一轮是否读回、定义因子提示词里有没有卡片块、定义因子给的位号、最终回答开头。
用法：python copy_check.py <tag> ...（tag 对应 tools/multi_<tag>.json）"""
import sys, os, io, json, gzip, re, datetime as dt, requests
HERE = os.path.dirname(os.path.abspath(__file__)); AUD = os.path.join(HERE, '..', 'ctx_audit'); TOOLS = os.path.join(HERE, '..', 'tools')
sys.path.insert(0, AUD); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import fetch_audit, card_src


def factors(o):
    try:
        a, b = o.find('{'), o.rfind('}'); j = json.loads(o[a:b + 1])
    except Exception:
        return None
    return [((f.get('source_label') or f.get('name') or ''), sorted(str(x).split('.')[0] for x in f.get('documented_tags') or []), f.get('unit'))
            for f in j.get('historian_factors') or []]


BASE = "https://<HOST>:5678/n8n"; CP = os.environ.get("WFID", "EIBVIi74m90EYSsB")  # 主线对照时 WFID=WdjEhxyWuv5DPwcs
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ex = [(int(e['id']), dt.datetime.fromisoformat(e['startedAt'].replace('Z', '+00:00')))
      for e in s.get(f"{BASE}/api/v1/executions", params={'workflowId': CP, 'limit': 100}, timeout=180).json()['data'] if e.get('startedAt')]
for tag in sys.argv[1:]:
    d = json.load(io.open(os.path.join(TOOLS, 'multi_%s.json' % tag), encoding='utf-8'))
    p = d['session'].split('-'); t = dt.datetime.strptime(p[2] + p[3], '%Y%m%d%H%M%S').replace(tzinfo=dt.timezone.utc)
    print('######', tag, d['session'])
    for tr in d['turns']:
        cands = sorted([e for e in ex if abs((e[1] - t).total_seconds()) <= 3], key=lambda e: e[0])
        x = None
        for i, _ in cands:
            fetch_audit.one(i)
            y = json.load(gzip.open(os.path.join(AUD, 'x_%d.json.gz' % i), 'rt', encoding='utf-8'))
            cc = (y['nodes'].get('Capture context') or [{}])[0] or {}
            if str(cc.get('chatSessionId') or '').replace('debug:', '') == d['session'] and cc.get('originalUserMessage') == tr['question']: x = y; break
        t = t + dt.timedelta(seconds=tr['sec'])
        if not x: print(' T%d 没找到执行' % tr['turn']); continue
        n = x['nodes']; cc = n['Capture context'][0]; scs = (n.get('Save Conversation State') or [{}])[-1] or {}
        loaded = (cc.get('conversation_state') or {}).get('turn_cards') or []
        nxt = (scs.get('conversation_state_next') or {}).get('turn_cards') or []
        cc_calls = [c for c in x['llm'] if c['parent'] == 'Coverage Check LLM']
        has_block = ['EARLIER_TURN_CARDS_V3; cards built' in ''.join(m if isinstance(m, str) else '' for m in c['messages']) for c in cc_calls]
        print(' T%d id=%d http=%s %ss | 读回卡片 %d 张 | 存后卡片 %d 张 | 定义因子调用 %d 次、含卡片块 %s' % (tr['turn'], x['id'], tr['http'], tr['sec'], len(loaded), len(nxt), len(cc_calls), has_block))
        if nxt: print('    本轮卡片:', json.dumps([(q.get('quantity'), [str(g).split('.')[0] for g in q.get('tags', [])], q.get('settled')) for q in nxt[-1].get('quantities', [])], ensure_ascii=False)[:400], '| period', nxt[-1].get('period_used'), nxt[-1].get('period_source'))
        card_src.one(x['id'])
        so = json.load(io.open(os.path.join(AUD, 's_%d.json' % x['id']), encoding='utf-8'))
        for k, o in enumerate(so.get('cc_output') or []):
            fs = factors(o or '')
            print('    定义因子#%d:' % (k + 1), 'PARSE_FAIL' if fs is None else ' | '.join('%s=%s' % (l, '+'.join(g) or '[]') for l, g, u in fs)[:400])
            try:
                a, b = (o or '').find('{'), (o or '').rfind('}'); jj = json.loads(o[a:b + 1])
                print('      装置模型查询:', ['%s:%s' % (str(x.get('tool', ''))[6:], x.get('tag')) for x in jj.get('plant_lookups') or []])
            except Exception:
                pass
        ans = tr['answer'] if isinstance(tr['answer'], str) else str(tr['answer'])
        print('    回答开头:', re.sub(r'\s+', ' ', ans)[:260])
