# Builds the final soundtrack: narration + ducked music + sound design keyed to the timeline.
import json, subprocess
TL = json.load(open('timeline.json')); L = {l['id']: l for l in TL['lines']}; total = TL['total']
def wt(i, w):
    for x in L[i]['words']:
        if ''.join(c for c in x[0].lower() if c.isalnum()).startswith(w): return x[1]
    return L[i]['start']
ins, flt = [], []
def add(path, t, vol=1.0, extra=''):
    k = len(ins); ins.append(path); ms = int(max(0, t) * 1000)
    flt.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol}{extra},adelay={ms}|{ms}[a{k}]")
for l in TL['lines']: add(f"audio/{l['id']}.mp3", l['start'], 1.0)
nv = len(ins)
# SFX
add('sfx/hit.mp3', 0.9, 0.7)
add('sfx/rev.mp3', L['o1']['start'] + 0.2, 0.35)
add('sfx/ignite.mp3', wt('o1', 'explosions'), 0.6)
add('sfx/idle.mp3', L['o3']['start'] - 0.5, 0.25, ',afade=t=in:d=1,afade=t=out:st=18:d=2')
add('sfx/spool.mp3', L['o5']['start'] + 1.0, 0.4)
for i in range(1, 7):
    t = L[f't{i}']['start'] - 0.7
    add('sfx/whoosh.mp3', t, 0.45); add('sfx/hit.mp3', t + 0.6, 0.35)
add('sfx/mech.mp3', L['b1']['start'], 0.35, ',afade=t=out:st=8:d=2')
add('sfx/ignite.mp3', wt('b5', 'spark'), 0.8); add('sfx/hit.mp3', L['b6']['start'] + 0.3, 0.5)
add('sfx/idle.mp3', L['b8']['start'], 0.25, ',afade=t=in:d=1.5,afade=t=out:st=17:d=3')
add('sfx/rev.mp3', L['b9']['start'] + 1.0, 0.45)
add('sfx/idle.mp3', L['c1']['start'], 0.18, ',afade=t=in:d=1,afade=t=out:st=17:d=3')
add('sfx/spool.mp3', L['c4']['start'] + 1.0, 0.5)
add('sfx/spool.mp3', L['d1']['start'] + 0.3, 0.35)
add('sfx/whoosh.mp3', L['d4']['start'] + 0.5, 0.3)
add('sfx/idle.mp3', L['f2']['start'], 0.22, ',afade=t=in:d=1,afade=t=out:st=17:d=3')
add('sfx/rev.mp3', L['f4']['start'] + 0.2, 0.4); add('sfx/hit.mp3', L['f5']['start'] + L['f5']['dur'] + 0.4, 0.6)
for tag in ['b2','b8','e2','f1']: add('sfx/blip.mp3', L[tag]['start'] + 0.1, 0.25)
# music bed: loop to total, ducked under voice via sidechain
mk = len(ins); ins.append('sfx/music.mp3')
flt.append(f"[{mk}:a]aresample=48000,aformat=channel_layouts=stereo,aloop=loop=-1:size=2e9,atrim=0:{total},volume=0.32,afade=t=in:d=2,afade=t=out:st={total-4}:d=4[mus]")
vo = ''.join(f"[a{k}]" for k in range(nv)); fx = ''.join(f"[a{k}]" for k in range(nv, mk))
flt.append(f"{vo}amix=inputs={nv}:normalize=0,asplit[vo][sc]")
flt.append(f"[mus][sc]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[duck]")
flt.append(f"{fx}amix=inputs={mk-nv}:normalize=0[fx]")
flt.append(f"[vo][duck][fx]amix=inputs=3:normalize=0,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=11[out]")
cmd = ['ffmpeg', '-y', '-v', 'error'] + sum([['-i', p] for p in ins], []) + ['-filter_complex', ';'.join(flt), '-map', '[out]', '-t', str(total), '-c:a', 'aac', '-b:a', '256k', 'soundtrack.m4a']
subprocess.run(cmd, check=True); print('ok', total)
