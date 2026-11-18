# -*- coding: utf-8 -*-
import json,io,glob,re,collections,statistics
S=collections.Counter(); T=[]; ID=[]; rows=[]
def pfx(s): return re.sub(r'\s+','',str(s or ''))[:80]
for f in sorted(glob.glob('e_*.json')):
    try: e=json.load(io.open(f,encoding='utf-8')); rd=e['data']['resultData']['runData']
    except Exception: continue
    if 'Grouped RAGFlow Retrieval' not in rd: continue
    S['exec']+=1
    tag_snips=set(); id_snips=set(); tagrun=None
    tot_rag_ms=0
    for r in rd['Grouped RAGFlow Retrieval']:
        tot_rag_ms+=r.get('executionTime') or 0
        try: j=r['data']['main'][0][0]['json']
        except Exception: continue
        vs=((j.get('unit') or {}).get('params') or {}).get('query_variants') or []
        try: oo=json.loads(j.get('output') or '{}')
        except Exception: oo={}
        es=oo.get('evidence_summary') or []
        if any(str(v.get('variant_id','')).startswith('tag_document_') for v in vs):
            vcc=((oo.get('raw_result') or {}).get('variant_chunk_counts')) or []
            tagrun={'ms':r.get('executionTime'),'vcc':[(x.get('variant_id'),x.get('chunk_count',x.get('count'))) for x in vcc] if isinstance(vcc,list) else vcc,'sel':len(es),'q':[v.get('question') for v in vs]}
            for x in es: tag_snips.add(pfx(x.get('snippet')))
        for x in es:
            if 'identity_probe' in str(x.get('variant_id','')) or 'tag_identity_probe' in str(x.get('lang_variant','')): id_snips.add(pfx(x.get('snippet')))
    # evidence packet
    try: ev=rd['Evidence Packet Builder'][-1]['data']['main'][0][0]['json']['evidence_packet']
    except Exception: ev=[]
    tag_e={x['evidence_id'] for x in ev if pfx(x.get('snippet')) in tag_snips}
    id_e={x['evidence_id'] for x in ev if pfx(x.get('snippet')) in id_snips}
    try: ans=json.dumps(rd['Restore Chat Output'][-1]['data']['main'][0][0]['json'],ensure_ascii=False)
    except Exception: ans=''
    cited=set(re.findall(r'\[(E\d+)\]',ans))
    rows.append((f[2:-5], tagrun and tagrun['ms'], tagrun and tagrun['vcc'], tagrun and tagrun['sel'], len(ev), len(tag_e), len(tag_e & cited), len(id_snips), len(id_e), len(id_e & cited), tot_rag_ms))
print('执行数',S['exec'])
has=[r for r in rows if r[1] is not None]
print('有位号资料检索单元',len(has),'| 耗时中位数(ms)',statistics.median([r[1] for r in has]),'| 最长',max(r[1] for r in has))
print('文档检索合计中位数(ms)',statistics.median([r[10] for r in rows]))
print('进证据包的位号资料条数 合计',sum(r[5] for r in rows),'| 被回答引用',sum(r[6] for r in rows),'| 有引用的执行',sum(1 for r in rows if r[6]))
print('身份补查片段 合计',sum(r[7] for r in rows),'| 进证据包',sum(r[8] for r in rows),'| 被引用',sum(r[9] for r in rows))
vc=collections.Counter()
for r in has:
    for v in (r[2] or []):
        if isinstance(v,tuple): vc[(v[0], 'zero' if not v[1] else 'some')]+=1
print('变体返回',dict(vc))
for r in has[:8]: print(r[:10])
