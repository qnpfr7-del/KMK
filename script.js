/* 만족도조사 자동 집계 - 현재 제공된 1페이지 양식 기준 */
const REF_W = 1240;
const REF_H = 1753;

// PDF.js는 PDF 파일을 브라우저에서 이미지로 바꾸기 위해서만 사용합니다.
// 인터넷이 차단된 행정망에서는 JPG/PNG 스캔을 사용하거나,
// README의 안내대로 pdf.min.mjs/pdf.worker.min.mjs를 로컬 파일로 두세요.
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const SCALE_LABELS = ['매우 만족','만족','보통','불만족','매우 불만족'];

const QUESTION_LABELS = {
  q2: [
    '강의에 대한 전반적인 만족도',
    '참여 인원이 적당했다고 생각하십니까?',
    '운영시간이 적절하다고 생각하십니까?',
    '프로그램 과정에 만족하십니까?'
  ],
  q3: [
    '교육 내용이 적절하다고 생각하십니까?',
    '강사 선정이 적절하다고 생각하십니까?',
    '네트워크 활성화에 도움이 되었습니까?'
  ],
  q4: ['취업지원','창업지원','진로설계','자기계발','문화예술','네트워크','기타']
};

// 좌표는 제공된 빈 설문지(1240 x 1753)를 기준으로 한 고정 영역입니다.
// 빨간색 강의명/강사명이 바뀌어도 응답 칸의 위치가 같다면 수정할 필요가 없습니다.
const REGIONS = {
  gender: [
    {label:'남', x1:145, y1:394, x2:275, y2:432},
    {label:'여', x1:340, y1:394, x2:465, y2:432}
  ],
  q2: {
    rows: [[603,636],[636,672],[672,709],[709,745]],
    cols: [[436,572],[572,708],[708,843],[843,979],[979,1115]]
  },
  q3: {
    rows: [[901,943],[943,986],[986,1028]],
    cols: [[436,572],[572,708],[708,843],[843,979],[979,1115]]
  },
  q4: [
    {label:'취업지원', x1:124, y1:1135, x2:366, y2:1177},
    {label:'창업지원', x1:620, y1:1135, x2:862, y2:1177},
    {label:'진로설계', x1:124, y1:1177, x2:366, y2:1219},
    {label:'자기계발', x1:620, y1:1177, x2:862, y2:1219},
    {label:'문화예술', x1:124, y1:1219, x2:366, y2:1261},
    {label:'네트워크', x1:620, y1:1219, x2:862, y2:1261},
    {label:'기타', x1:124, y1:1261, x2:366, y2:1304}
  ]
};

let selectedFiles = [];
let records = [];
let templateCanvas = null;
let templateCtx = null;
let templatePixels = null;
let pdfjsLib = null;

document.addEventListener('DOMContentLoaded', async () => {
  bindUI();
  await loadTemplate();
});

function bindUI(){
  const input = document.getElementById('fileInput');
  input.addEventListener('change', e => setFiles([...e.target.files]));

  const dz = document.getElementById('dropZone');
  ['dragenter','dragover'].forEach(n => dz.addEventListener(n, e => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(n => dz.addEventListener(n, e => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', e => setFiles([...e.dataTransfer.files].filter(validFile)));

  document.getElementById('threshold').addEventListener('input', e => {
    document.getElementById('thresholdText').textContent = Number(e.target.value).toFixed(2) + '%';
  });

  document.getElementById('analyzeBtn').addEventListener('click', analyzeAll);
  document.getElementById('resetBtn').addEventListener('click', resetAll);
  document.getElementById('downloadCsvBtn').addEventListener('click', downloadCSV);
  document.getElementById('reviewFilter').addEventListener('change', renderReview);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('imageModal').addEventListener('click', e => {
    if(e.target.id === 'imageModal') closeModal();
  });

  document.querySelectorAll('.nav').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function validFile(f){
  return f.type === 'application/pdf' || f.type.startsWith('image/');
}

function setFiles(files){
  selectedFiles = files.filter(validFile);
  const list = document.getElementById('fileList');
  document.getElementById('fileCount').textContent = selectedFiles.length + '개';
  document.getElementById('analyzeBtn').disabled = selectedFiles.length === 0;

  if(!selectedFiles.length){
    list.className = 'file-list empty-box';
    list.textContent = '아직 선택된 파일이 없습니다.';
    return;
  }

  list.className = 'file-list';
  list.innerHTML = selectedFiles.map(f => `
    <div class="file-item">
      <span>${escapeHtml(f.name)}</span>
      <span>${formatBytes(f.size)}</span>
    </div>
  `).join('');
}

async function loadTemplate(){
  const img = await loadImage('template.png');
  templateCanvas = document.createElement('canvas');
  templateCanvas.width = REF_W;
  templateCanvas.height = REF_H;
  templateCtx = templateCanvas.getContext('2d', {willReadFrequently:true});
  templateCtx.drawImage(img,0,0,REF_W,REF_H);
  templatePixels = templateCtx.getImageData(0,0,REF_W,REF_H).data;
}

async function ensurePdfJs(){
  if(pdfjsLib) return pdfjsLib;
  try{
    pdfjsLib = await import(PDFJS_CDN);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    return pdfjsLib;
  }catch(err){
    throw new Error('PDF 분석용 라이브러리를 불러오지 못했습니다. 행정망 등 인터넷이 차단된 환경이면 PDF를 JPG/PNG로 스캔하거나 README의 오프라인 PDF.js 설치 방법을 사용해주세요.');
  }
}

async function analyzeAll(){
  if(!templatePixels) return alert('빈 설문지 기준 이미지를 불러오지 못했습니다.');
  records = [];
  showProgress(true);

  let pages = [];
  for(const file of selectedFiles){
    if(file.type === 'application/pdf'){
      const pdfPages = await pdfToCanvases(file);
      pdfPages.forEach((p,i) => pages.push({file, page:i+1, canvas:p}));
    }else{
      const c = await imageFileToCanvas(file);
      pages.push({file, page:1, canvas:c});
    }
  }

  for(let i=0;i<pages.length;i++){
    updateProgress(i, pages.length, `설문 ${i+1}/${pages.length} 분석 중`);
    await nextFrame();
    const normalized = normalizeCanvas(pages[i].canvas);
    const aligned = alignCanvas(normalized);
    const result = analyzePage(aligned);
    result.fileName = pages[i].file.name;
    result.page = pages[i].page;
    result.imageDataUrl = aligned.toDataURL('image/jpeg', .75);
    result.id = `${Date.now()}_${i}`;
    records.push(result);
  }

  updateProgress(pages.length,pages.length,'분석 완료');
  setTimeout(()=>showProgress(false),600);
  renderResults();
  renderReview();
  switchView('result');
}

async function pdfToCanvases(file){
  const lib = await ensurePdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({data}).promise;
  const result = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const base = page.getViewport({scale:1});
    const scale = REF_W / base.width;
    const viewport = page.getViewport({scale});
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    await page.render({canvasContext:c.getContext('2d'), viewport}).promise;
    result.push(c);
  }
  return result;
}

async function imageFileToCanvas(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img,0,0);
    return c;
  }finally{
    URL.revokeObjectURL(url);
  }
}

function normalizeCanvas(src){
  const c = document.createElement('canvas');
  c.width = REF_W; c.height = REF_H;
  const ctx = c.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle = 'white'; ctx.fillRect(0,0,REF_W,REF_H);

  // A4 세로 비율에 맞춰 전체 페이지를 동일 크기로 정규화
  ctx.drawImage(src,0,0,REF_W,REF_H);
  return c;
}

function alignCanvas(src){
  const srcCtx = src.getContext('2d',{willReadFrequently:true});
  const srcData = srcCtx.getImageData(0,0,REF_W,REF_H).data;

  let bestDx = 0, bestDy = 0, bestScore = Infinity;
  // 작은 스캔 위치 오차를 보정. 큰 회전/왜곡은 검토 대상으로 남길 수 있음.
  for(let dy=-10; dy<=10; dy+=2){
    for(let dx=-10; dx<=10; dx+=2){
      let score=0, n=0;
      for(let y=120; y<1550; y+=22){
        for(let x=90; x<1150; x+=22){
          const sx=x+dx, sy=y+dy;
          if(sx<0||sy<0||sx>=REF_W||sy>=REF_H) continue;
          const si=(sy*REF_W+sx)*4;
          const ti=(y*REF_W+x)*4;
          const sg=(srcData[si]+srcData[si+1]+srcData[si+2])/3;
          const tg=(templatePixels[ti]+templatePixels[ti+1]+templatePixels[ti+2])/3;
          // 흰 여백보다 인쇄선/글자 쪽에 가중치
          if(tg < 225){
            score += Math.abs(sg-tg);
            n++;
          }
        }
      }
      const avg = n ? score/n : Infinity;
      if(avg < bestScore){ bestScore=avg; bestDx=dx; bestDy=dy; }
    }
  }

  if(bestDx===0 && bestDy===0) return src;
  const out=document.createElement('canvas');
  out.width=REF_W; out.height=REF_H;
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,REF_W,REF_H);
  ctx.drawImage(src,-bestDx,-bestDy);
  return out;
}

function analyzePage(canvas){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const scan=ctx.getImageData(0,0,REF_W,REF_H).data;
  const threshold=Number(document.getElementById('threshold').value);

  const genderScores = REGIONS.gender.map(r => addedInkScore(scan,r));
  const genderPick = pickOne(genderScores,threshold);
  const gender = genderPick.index >= 0 ? REGIONS.gender[genderPick.index].label : '';

  const q2=[], q2Meta=[];
  REGIONS.q2.rows.forEach(row => {
    const scores=REGIONS.q2.cols.map(col => addedInkScore(scan,{
      x1:col[0]+8,y1:row[0]+5,x2:col[1]-8,y2:row[1]-5
    }));
    const pick=pickOne(scores,threshold);
    q2.push(pick.index>=0 ? SCALE_LABELS[pick.index] : '');
    q2Meta.push({scores,pick});
  });

  const q3=[], q3Meta=[];
  REGIONS.q3.rows.forEach(row => {
    const scores=REGIONS.q3.cols.map(col => addedInkScore(scan,{
      x1:col[0]+8,y1:row[0]+5,x2:col[1]-8,y2:row[1]-5
    }));
    const pick=pickOne(scores,threshold);
    q3.push(pick.index>=0 ? SCALE_LABELS[pick.index] : '');
    q3Meta.push({scores,pick});
  });

  const q4Scores=REGIONS.q4.map(r => addedInkScore(scan,{
    x1:r.x1+5,y1:r.y1+5,x2:r.x2-5,y2:r.y2-5
  }));
  const q4=REGIONS.q4.filter((r,i)=>q4Scores[i]>=threshold).map(r=>r.label);

  const warnings=[];
  if(genderPick.warning) warnings.push('성별');
  q2Meta.forEach((m,i)=>{ if(m.pick.warning) warnings.push(`2-${i+1}`); });
  q3Meta.forEach((m,i)=>{ if(m.pick.warning) warnings.push(`3-${i+1}`); });

  return {gender,q2,q3,q4,warnings,genderScores,q2Meta,q3Meta,q4Scores};
}

function addedInkScore(scan,r){
  let newDark=0, eligible=0;
  const x1=Math.max(0,Math.floor(r.x1)), y1=Math.max(0,Math.floor(r.y1));
  const x2=Math.min(REF_W,Math.ceil(r.x2)), y2=Math.min(REF_H,Math.ceil(r.y2));

  for(let y=y1;y<y2;y+=2){
    for(let x=x1;x<x2;x+=2){
      const i=(y*REF_W+x)*4;
      const tg=(templatePixels[i]+templatePixels[i+1]+templatePixels[i+2])/3;
      const sg=(scan[i]+scan[i+1]+scan[i+2])/3;
      // 빈 템플릿에서 밝은 곳에 새로 생긴 진한 픽셀만 체크
      if(tg>205){
        eligible++;
        if(sg<145 && (tg-sg)>45) newDark++;
      }
    }
  }
  return eligible ? (newDark/eligible)*100 : 0;
}

function pickOne(scores,threshold){
  const order=scores.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
  const top=order[0], second=order[1]||{v:0};
  if(!top || top.v<threshold){
    return {index:-1,warning:true,reason:'미응답 또는 인식 약함'};
  }
  const close = second.v>=threshold && (top.v-second.v)<Math.max(.18,top.v*.22);
  return {index:top.i,warning:close,reason:close?'복수 표시 가능성':''};
}

function renderResults(){
  const total=records.length;
  const warningCount=records.filter(r=>r.warnings.length).length;
  const completed=records.filter(r=>r.q2.filter(Boolean).length===4 && r.q3.filter(Boolean).length===3).length;
  const noGender=records.filter(r=>!r.gender).length;

  document.getElementById('stats').innerHTML=[
    stat('총 설문지',total+'부'),
    stat('주요 문항 완전 판독',completed+'부'),
    stat('검토 필요',warningCount+'부'),
    stat('성별 미판독',noGender+'부')
  ].join('');

  const g = countValues(records.map(r=>r.gender),['남','여','']);
  document.getElementById('genderResult').innerHTML = bars([
    ['남',g['남']||0],['여',g['여']||0],['미응답/미판독',g['']||0]
  ],total);

  document.getElementById('q2Result').innerHTML=likertTable(
    QUESTION_LABELS.q2,
    QUESTION_LABELS.q2.map((_,i)=>records.map(r=>r.q2[i]))
  );
  document.getElementById('q3Result').innerHTML=likertTable(
    QUESTION_LABELS.q3,
    QUESTION_LABELS.q3.map((_,i)=>records.map(r=>r.q3[i]))
  );

  const q4Counts=Object.fromEntries(QUESTION_LABELS.q4.map(x=>[x,0]));
  records.forEach(r=>r.q4.forEach(v=>{ if(v in q4Counts) q4Counts[v]++; }));
  document.getElementById('q4Result').innerHTML=bars(
    QUESTION_LABELS.q4.map(v=>[v,q4Counts[v]]),
    Math.max(1,total)
  );
}

function renderReview(){
  const filter=document.getElementById('reviewFilter').value;
  const items=records.filter(r=>filter==='all'||r.warnings.length);
  const root=document.getElementById('reviewList');

  if(!items.length){
    root.innerHTML='<div class="empty-box">표시할 설문이 없습니다.</div>';
    return;
  }

  root.innerHTML=items.map(r=>`
    <article class="review-card ${r.warnings.length?'warning':''}" data-id="${r.id}">
      <div class="review-head">
        <div>
          <strong>${escapeHtml(r.fileName)} ${r.page>1?`- ${r.page}p`:''}</strong>
          <div class="help">${r.warnings.length?'검토 대상: '+r.warnings.join(', '):'자동 판독 완료'}</div>
        </div>
        <div>
          <span class="${r.warnings.length?'warning-badge':'ok-badge'}">${r.warnings.length?'검토 필요':'정상'}</span>
          <button class="original-btn" onclick="showOriginal('${r.id}')">원본 보기</button>
        </div>
      </div>

      <div class="review-grid">
        ${selectField(r.id,'gender','성별',r.gender,['','남','여'])}
        ${r.q2.map((v,i)=>selectField(r.id,`q2.${i}`,`2-${i+1}. ${shortLabel(QUESTION_LABELS.q2[i])}`,v,['',...SCALE_LABELS])).join('')}
        ${r.q3.map((v,i)=>selectField(r.id,`q3.${i}`,`3-${i+1}. ${shortLabel(QUESTION_LABELS.q3[i])}`,v,['',...SCALE_LABELS])).join('')}
        <label>
          4. 희망 프로그램
          <div class="q4-checks">
            ${QUESTION_LABELS.q4.map(v=>`
              <label><input type="checkbox" ${r.q4.includes(v)?'checked':''} onchange="updateQ4('${r.id}','${v}',this.checked)"> ${v}</label>
            `).join('')}
          </div>
        </label>
      </div>
    </article>
  `).join('');
}

function selectField(id,path,label,value,options){
  return `<label>${escapeHtml(label)}
    <select onchange="updateAnswer('${id}','${path}',this.value)">
      ${options.map(o=>`<option value="${escapeHtml(o)}" ${o===value?'selected':''}>${escapeHtml(o||'미응답/미판독')}</option>`).join('')}
    </select>
  </label>`;
}

function updateAnswer(id,path,value){
  const r=records.find(x=>x.id===id); if(!r)return;
  if(path==='gender') r.gender=value;
  else{
    const [key,idx]=path.split('.');
    r[key][Number(idx)]=value;
  }
  r.warnings=[]; // 사용자가 확인한 것으로 처리
  renderResults();
  renderReview();
}
window.updateAnswer=updateAnswer;

function updateQ4(id,value,checked){
  const r=records.find(x=>x.id===id); if(!r)return;
  if(checked && !r.q4.includes(value)) r.q4.push(value);
  if(!checked) r.q4=r.q4.filter(v=>v!==value);
  renderResults();
}
window.updateQ4=updateQ4;

function showOriginal(id){
  const r=records.find(x=>x.id===id); if(!r)return;
  document.getElementById('modalTitle').textContent=`${r.fileName} ${r.page>1?'- '+r.page+'p':''}`;
  document.getElementById('modalImage').src=r.imageDataUrl;
  document.getElementById('imageModal').classList.remove('hidden');
}
window.showOriginal=showOriginal;

function closeModal(){
  document.getElementById('imageModal').classList.add('hidden');
  document.getElementById('modalImage').src='';
}

function likertTable(labels,answers){
  let head='<tr><th>문항</th>'+SCALE_LABELS.map(x=>`<th>${x}</th>`).join('')+'<th>미응답/미판독</th><th>응답계</th></tr>';
  let rows=labels.map((label,i)=>{
    const counts=countValues(answers[i],[...SCALE_LABELS,'']);
    const answered=SCALE_LABELS.reduce((a,k)=>a+(counts[k]||0),0);
    return `<tr>
      <td>${escapeHtml(label)}</td>
      ${SCALE_LABELS.map(k=>`<td>${counts[k]||0}</td>`).join('')}
      <td>${counts['']||0}</td>
      <td class="total">${answered}</td>
    </tr>`;
  }).join('');
  return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function bars(items,total){
  const max=Math.max(1,...items.map(x=>x[1]));
  return items.map(([label,count])=>{
    const pct=total ? (count/total*100) : 0;
    return `<div class="bar-row">
      <span>${escapeHtml(label)}</span>
      <div class="bar"><span style="width:${(count/max*100).toFixed(1)}%"></span></div>
      <strong>${count} (${pct.toFixed(1)}%)</strong>
    </div>`;
  }).join('');
}

function countValues(values,keys){
  const out=Object.fromEntries(keys.map(k=>[k,0]));
  values.forEach(v=>{ if(v in out) out[v]++; else out[v]=1; });
  return out;
}
function stat(label,value){return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;}

function downloadCSV(){
  if(!records.length)return;
  const headers=[
    '파일명','페이지','성별',
    ...QUESTION_LABELS.q2.map((_,i)=>`2-${i+1}`),
    ...QUESTION_LABELS.q3.map((_,i)=>`3-${i+1}`),
    '희망프로그램','검토필요'
  ];
  const rows=records.map(r=>[
    r.fileName,r.page,r.gender,
    ...r.q2,...r.q3,
    r.q4.join('|'),
    r.warnings.join('|')
  ]);
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='만족도조사_응답집계.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelector(`.nav[data-view="${name}"]`).classList.add('active');
  const titles={upload:'설문 업로드',result:'집계 결과',review:'응답 검토'};
  document.getElementById('pageTitle').textContent=titles[name];
}

function resetAll(){
  selectedFiles=[];records=[];
  document.getElementById('fileInput').value='';
  setFiles([]);
  document.getElementById('stats').innerHTML='';
  document.getElementById('reviewList').innerHTML='';
  switchView('upload');
}

function showProgress(on){document.getElementById('progressWrap').classList.toggle('hidden',!on);}
function updateProgress(done,total,text){
  const pct=total?Math.round(done/total*100):0;
  document.getElementById('progressText').textContent=text;
  document.getElementById('progressPct').textContent=pct+'%';
  document.getElementById('progressBar').style.width=pct+'%';
}
function nextFrame(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));}
function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});}
function formatBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';}
function csvCell(v){const s=String(v??'');return '"'+s.replaceAll('"','""')+'"';}
function shortLabel(s){return s.length>18?s.slice(0,18)+'…':s;}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
