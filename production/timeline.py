import json,subprocess
L=json.load(open('script.json'));t=1.2;out=[]
prev=None
for i,tag,txt in L:
    d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'audio/{i}.mp3']))
    if tag.startswith('title'): t+=1.6
    elif prev and prev.startswith('title'): t+=0.9
    elif prev!=tag: t+=1.4
    al=json.load(open(f'audio/{i}.json'));ch=al['characters'];st=al['character_start_times_seconds'];en=al['character_end_times_seconds']
    words=[];cur='';ws=None
    for c,s,e in zip(ch,st,en):
        if c==' ':
            if cur: words.append([cur,ws+t,we+t]);cur=''
        else:
            if not cur: ws=s
            cur+=c;we=e
    if cur: words.append([cur,ws+t,we+t])
    out.append(dict(id=i,tag=tag,text=txt,start=t,dur=d,words=words))
    t+=d+0.55; prev=tag
total=t+3.5
json.dump(dict(lines=out,total=total),open('timeline.json','w'))
print(total)
