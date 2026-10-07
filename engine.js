/* Survey geometry and image comparison. All coordinates come from the active template. */
const SurveyEngine = (() => {
  const W=1240,H=1753;
  const gray = data => {const g=new Uint8Array(data.length/4);for(let i=0;i<g.length;i++)g[i]=(data[i*4]+data[i*4+1]+data[i*4+2])/3;return g;};
  const canvas = (w=W,h=H) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  function normalize(src){const c=canvas();const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,W,H);x.drawImage(src,0,0,W,H);return c;}
  function lines(g,w,h){
    const result=[];
    for(let y=0;y<h;y++){
      let start=-1,gaps=0;
      for(let x=0;x<=w;x++){
        if(x<w&&g[y*w+x]<170){if(start<0)start=x;gaps=0;}
        else if(start>=0&&++gaps>3){if(x-start>w*.5)result.push({y,x1:start,x2:x-gaps});start=-1;}
      }
    }
    const out=[];
    for(const r of result){const prev=out.at(-1);if(prev&&r.y-prev.y<5){prev.y=(prev.y+r.y)/2;prev.x1=Math.min(prev.x1,r.x1);prev.x2=Math.max(prev.x2,r.x2);}else out.push({...r});}
    return out;
  }
  function verticals(g,top,bottom,left,right){
    const xs=[];
    for(let x=Math.round(left);x<=right;x++){
      let n=0;for(let y=Math.ceil(top+4);y<bottom-4;y++)if(g[y*W+x]<180)n++;
      if(n/Math.max(1,bottom-top-8)>.7){if(xs.length&&x-xs.at(-1)<5)xs[xs.length-1]=(xs.at(-1)+x)/2;else xs.push(x);}
    }
    return xs;
  }
  async function parsePdf(file,pdfjs){
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),wasmUrl:"./vendor/wasm/"}).promise;
    try{
      if(pdf.numPages!==1)throw new Error('현재는 한 페이지 원본 양식을 지원합니다. 여러 페이지 양식은 페이지별로 등록해주세요.');
      const p=await pdf.getPage(1),v=p.getViewport({scale:1}),view=p.getViewport({scale:W/v.width});
      const raw=canvas(Math.round(view.width),Math.round(view.height));
      await p.render({canvasContext:raw.getContext('2d'),viewport:view}).promise;
      const c=normalize(raw),g=gray(c.getContext('2d').getImageData(0,0,W,H).data);
      const text=await p.getTextContent();
      const items=text.items.filter(i=>i.str?.trim()).map(i=>{
        const t=pdfjs.Util.transform(view.transform,i.transform);
        return {text:i.str.trim(),x:t[4]*W/raw.width,y:(t[5]-Math.hypot(t[2],t[3])/2)*H/raw.height,width:i.width*view.scale*W/raw.width,height:Math.hypot(t[2],t[3])*H/raw.height};
      }).sort((a,b)=>a.y-b.y||a.x-b.x);
      if(!items.length)throw new Error('텍스트가 없는 스캔 양식입니다. 한글·Word 등에서 내보낸 원본 PDF를 등록해주세요.');
      const rules=lines(g,W,H);
      const headings=items.filter(i=>/^\d+[.)]\s/.test(i.text));
      const questions=[];
      for(let n=0;n<headings.length;n++){
        const heading=headings[n],end=headings[n+1]?.y??H*.87,section=heading.text.match(/^\d+/)[0];
        const body=items.filter(i=>i.y>heading.y+8&&i.y<end-6);
        const rr=rules.filter(r=>r.y>heading.y+10&&r.y<end);
        let found=false;
        // A ruled matrix: first column is the row question; remaining cells are answer options.
        for(let k=0;k<Math.min(1,rr.length-2);k++){
          const xs=[rr[k].x1,...verticals(g,rr[k].y,rr[k+1].y,rr[k].x1+6,rr[k].x2-6),rr[k].x2];
          if(xs.length<4)continue;
          const labels=xs.slice(1,-1).map((x,j)=>body.filter(t=>t.y>rr[k].y&&t.y<rr[k+1].y&&t.x+t.width/2>x&&t.x+t.width/2<xs[j+2]).map(t=>t.text).join(' '));
          if(labels.some(l=>!l)||labels.some(l=>/예\s*시|유\s*형|연\s*번|[①②③④⑤⑥⑦⑧⑨⑩]/.test(l)))continue;
          let row=0;
          for(let r=k+1;r<rr.length-1;r++){
            const label=body.filter(t=>t.y>rr[r].y&&t.y<rr[r+1].y&&t.x<xs[1]).map(t=>t.text).join(' ');
            if(!label)break;
            questions.push({id:`q${section}_${++row}`,section,label,type:'single',options:labels.map((label,j)=>({label,rect:{x1:xs[j+1]+7,y1:rr[r].y+5,x2:xs[j+2]-7,y2:rr[r+1].y-5}}))});
          }
          if(row){found=true;break;}
        }
        if(found)continue;
        // Numbered options in rows, including two-column program tables.
        const markers=[];
        for(const t of body){
          const re=/[①②③④⑤⑥⑦⑧⑨⑩]|(?:^|\s)\d+[.)]/g;let m;
          while((m=re.exec(t.text))){
            const rest=t.text.slice(m.index+m[0].length),next=rest.search(/[①②③④⑤⑥⑦⑧⑨⑩]/);
            const inline=(next>=0?rest.slice(0,next):rest).trim();
            const x=t.x+t.width*m.index/t.text.length;
            const neighbor=inline?null:body.filter(b=>Math.abs(b.y-t.y)<12&&b.x>t.x+t.width).sort((a,b)=>a.x-b.x)[0];
            let label=inline||neighbor?.text;
            let rect=null,parts=null;
            if(!inline&&rr.length>1){
              const borders=[rr[0].x1,...verticals(g,rr[0].y,rr[1].y,rr[0].x1+6,rr[0].x2-6),rr[0].x2];
              const cell=borders.findIndex((v,j)=>j<borders.length-2&&x>=v&&x<borders[j+1]);
              if(cell>=0){
                label=body.filter(b=>Math.abs(b.y-t.y)<12&&b.x>borders[cell+1]&&b.x+b.width/2<borders[cell+2]).map(b=>b.text).join('').replace(/\s+/g,'');
                const above=rr.filter(r=>r.y<t.y).at(-1),below=rr.find(r=>r.y>t.y);
                if(above&&below){rect={x1:borders[cell]+6,y1:above.y+5,x2:borders[cell+2]-6,y2:below.y-5};parts=[{...rect,x2:borders[cell+1]-6},{...rect,x1:borders[cell+1]+6}];}
              }
            }
            if(label)markers.push({label,x,y:t.y,end:inline?x+Math.max(60,t.width*(m[0].length+inline.length)/t.text.length):neighbor.x+neighbor.width,rect,parts});
          }
        }
        if(markers.length){
          const explicitMultiple=/복수|중복|모두\s*선택/.test(heading.text+' '+body.map(t=>t.text).join(' '));
          const uncertain=!/성별/.test(heading.text)&&!explicitMultiple;
          questions.push({id:`q${section}`,section,label:heading.text,type:explicitMultiple?'multiple':'single',typeNeedsReview:uncertain,options:markers.map(o=>({label:o.label,parts:o.parts,rect:o.rect||{x1:Math.max(0,o.x-12),y1:o.y-17,x2:Math.min(W,o.end+14),y2:o.y+20}}))});
        }else{
          questions.push({id:`q${section}`,section,label:heading.text,type:'text',options:[]});
        }
      }
      if(!questions.length)throw new Error('문항 번호와 표를 자동 인식하지 못했습니다. 문항 구조를 직접 설정해주세요.');
      return {canvas:c,schema:{version:2,questions,confirmed:false}};
    }finally{await pdf.destroy();}
  }
  function distance(g,w,h){
    const d=new Float32Array(w*h);for(let i=0;i<d.length;i++)d[i]=g[i]<215?0:1000;
    for(let y=1;y<h;y++)for(let x=1;x<w-1;x++){const i=y*w+x;d[i]=Math.min(d[i],d[i-1]+1,d[i-w]+1,d[i-w-1]+1.414,d[i-w+1]+1.414);}
    for(let y=h-2;y>=0;y--)for(let x=w-2;x>0;x--){const i=y*w+x;d[i]=Math.min(d[i],d[i+1]+1,d[i+w]+1,d[i+w+1]+1.414,d[i+w-1]+1.414);}
    return d;
  }
  function align(src,template,schema){
    // Match printed grid lines; question wording and handwriting are excluded from registration.
    const size=620,ratio=size/W,h=Math.round(H*ratio);
    const small=canvas(size,h);small.getContext('2d').drawImage(src,0,0,size,h);
    const sg=gray(small.getContext('2d').getImageData(0,0,size,h).data),dist=distance(sg,size,h);
    const tg=gray(template.getContext('2d').getImageData(0,0,W,H).data),rr=lines(tg,W,H);
    let points=[];
    for(const r of rr){
      if(r.y<H*.27||r.y>H*.77)continue;
      for(let x=r.x1+10;x<r.x2-10;x+=14)points.push([(x-W/2)*ratio,(r.y-H/2)*ratio]);
    }
    // Include vertical grid lines to constrain horizontal translation and independent X scale.
    for(const q of schema.questions){if(q.type==='text')continue;for(const o of q.options){
      const r=o.rect;
      for(const x of [r.x1-7,r.x2+7])for(let y=r.y1+3;y<r.y2;y+=10){
        if(tg[Math.round(y)*W+Math.round(x)]<160)points.push([(x-W/2)*ratio,(y-H/2)*ratio]);
      }
    }}
    for(let y=155;y<H*.46;y+=7)for(let x=70;x<W-70;x+=7)if(tg[Math.round(y)*W+x]<140)points.push([(x-W/2)*ratio,(y-H/2)*ratio]);
    if(points.length<50){
      points=[];for(let y=60;y<H-70;y+=12)for(let x=50;x<W-50;x+=12)if(tg[y*W+x]<140)points.push([(x-W/2)*ratio,(y-H/2)*ratio]);
    }
    function score(p){
      let sum=0;const [a,b,c,d,tx,ty]=p;
      for(const [x,y] of points){const xx=Math.round(a*x+c*y+size/2+tx),yy=Math.round(b*x+d*y+h/2+ty);sum+=xx<1||yy<1||xx>=size-1||yy>=h-1?20:Math.min(20,dist[yy*size+xx]);}
      return sum/Math.max(1,points.length);
    }
    let best={p:[1,0,0,1,0,0],score:Infinity};
    for(const angle of [-3,-1.5,0,1.5,3])for(const scale of [.96,1,1.04])for(const dx of [-12,0,12])for(const dy of [-12,0,12]){
      const r=angle*Math.PI/180,p=[scale*Math.cos(r),scale*Math.sin(r),-scale*Math.sin(r),scale*Math.cos(r),dx,dy],s=score(p);
      if(s<best.score)best={p,score:s};
    }
    for(const step of [.016,.008,.004,.002,.001,.0005]){
      for(let pass=0;pass<12;pass++){
        let changed=false;
        for(let j=0;j<6;j++)for(const sign of [-1,1]){
          const p=best.p.slice();p[j]+=sign*(j<4?step:step*700);
          if(p[0]<.85||p[0]>1.15||p[3]<.85||p[3]>1.15||Math.abs(p[1])>.12||Math.abs(p[2])>.12||Math.abs(p[4])>45||Math.abs(p[5])>45)continue;
          const s=score(p);if(s<best.score){best={p,score:s};changed=true;}
        }
        if(!changed)break;
      }
    }
    const [a,b,c,d,tx,ty]=best.p,dx=tx/ratio,dy=ty/ratio;
    const transform=[a,b,c,d,W/2+dx-a*W/2-c*H/2,H/2+dy-b*W/2-d*H/2];
    const inverse=new DOMMatrix(transform).inverse(),out=canvas(),ctx=out.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.setTransform(inverse);ctx.drawImage(src,0,0);
    const angle=Math.atan2(b,a)*180/Math.PI;
    return {canvas:out,meta:{score:best.score,angle,dx,dy,scaleX:Math.hypot(a,b),scaleY:Math.hypot(c,d),lowQuality:best.score>1.1,transform}};
  }
  function read(c,template,schema,threshold,meta){
    const scan=gray(c.getContext('2d').getImageData(0,0,W,H).data),base=gray(template.getContext('2d').getImageData(0,0,W,H).data);
    // Expand printed ink by two pixels so antialiasing and residual registration are not counted as marks.
    const mask=new Uint8Array(W*H);
    for(let y=4;y<H-4;y++)for(let x=4;x<W-4;x++)if(base[y*W+x]<215){for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)mask[(y+dy)*W+x+dx]=1;}
    const warnings=meta.lowQuality?['정렬']:[],answers={},scores={};
    for(const q of schema.questions){
      if(q.type==='text'){answers[q.id]='';continue;}
      const labelEvidence=[];
      const partScores=q.options.map(o=>{
        const regionScore=r=>{let ink=0,n=0;
        for(let y=Math.max(0,Math.ceil(r.y1));y<Math.min(H,r.y2);y++)for(let x=Math.max(0,Math.ceil(r.x1));x<Math.min(W,r.x2);x++){
          const i=y*W+x;if(!mask[i]){n++;if(scan[i]<215&&base[i]-scan[i]>30)ink++;}
        }
        return n?ink/n*100:0;};
        return (o.parts||[o.rect]).map(regionScore);
      });
      const labelScores=partScores.filter(s=>s.length>1).map(s=>s[1]).sort((a,b)=>a-b);
      const labelCut=Math.max(threshold*3,(labelScores[Math.floor(labelScores.length/2)]||0)+threshold*2);
      const ss=partScores.map((s,i)=>{if(s.length>1&&s[1]>=labelCut){labelEvidence.push(i);return Math.max(s[0],s[1]);}return s[0];});
      if(labelEvidence.length)warnings.push(q.id+' (문자 영역 확인)');
      scores[q.id]=ss;
      const order=ss.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),top=order[0]||{v:0,i:-1},second=order[1]||{v:0};
      if(q.type==='multiple'){
        // Never suppress a weak second selection solely because another mark is larger.
        answers[q.id]=q.options.filter((_,i)=>ss[i]>=threshold).map(o=>o.label);
        if(ss.some(s=>s>=threshold*.65&&s<threshold*1.8))warnings.push(q.id);
      }else{
        answers[q.id]=top.v>=threshold?q.options[top.i].label:'';
        if(top.v<threshold*1.25||second.v>=threshold||top.v-second.v<Math.max(.2,top.v*.25))warnings.push(q.id);
      }
    }
    if(meta.lowQuality){
      // Do not show guesses from a mismatched layout as actual responses.
      for(const q of schema.questions)answers[q.id]=q.type==='multiple'?[]:'';
      warnings.unshift('양식 불일치 또는 정렬 실패');
    }
    return {answers,scores,warnings};
  }
  return {W,H,normalize,parsePdf,align,read};
})();
