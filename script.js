const REF_W = 1240;
const REF_H = 1753;
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

  const templateInput = document.getElementById('templateFileInput');
  if(templateInput) templateInput.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      setTemplateStatus('처리 중');
      const canvas = file.type === 'application/pdf'
        ? (await pdfToCanvases(file))[0]
        : await imageFileToCanvas(file);
      const normalized = normalizeCanvas(canvas);
      await applyTemplateCanvas(normalized, file.name, true);
      setTemplateStatus('사용 중');
      alert('새 기준 설문 양식이 이 컴퓨터에 저장되었습니다.');
    }catch(err){
      console.error(err);
      setTemplateStatus('오류');
      alert('기준 양식을 불러오지 못했습니다: ' + err.message);
    }finally{
      e.target.value = '';
    }
  });

  const resetTemplateBtn = document.getElementById('resetTemplateBtn');
  if(resetTemplateBtn) resetTemplateBtn.addEventListener('click', async () => {
    await deleteStoredTemplate();
    await loadDefaultTemplate();
    setTemplateStatus('기본 양식');
  });
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
  try{
    const saved = await getStoredTemplate();
    if(saved?.dataUrl){
      const img = await loadImage(saved.dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = REF_W; canvas.height = REF_H;
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      ctx.fillStyle='white'; ctx.fillRect(0,0,REF_W,REF_H);
      ctx.drawImage(img,0,0,REF_W,REF_H);
      await applyTemplateCanvas(canvas, saved.name || '저장된 기준 양식', false);
      setTemplateStatus('저장 양식');
      return;
    }
  }catch(err){
    console.warn('저장된 기준 양식 복원 실패', err);
  }
  await loadDefaultTemplate();
}

async function loadDefaultTemplate(){
  const img = await loadImage('template.png');
  const canvas = document.createElement('canvas');
  canvas.width = REF_W; canvas.height = REF_H;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.fillStyle='white'; ctx.fillRect(0,0,REF_W,REF_H);
  ctx.drawImage(img,0,0,REF_W,REF_H);
  await applyTemplateCanvas(canvas, '기본 template.png', false);
}

async function applyTemplateCanvas(canvas, name, persist){
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  templatePixels = ctx.getImageData(0,0,REF_W,REF_H).data;

  const nameInput = document.getElementById('templateName');
  if(nameInput) nameInput.value = name;

  const preview = document.getElementById('templatePreview');
  const previewWrap = document.getElementById('templatePreviewWrap');
  if(preview && previewWrap){
    preview.src = canvas.toDataURL('image/jpeg', .82);
    previewWrap.style.display = 'block';
  }

  if(persist){
    const dataUrl = canvas.toDataURL('image/png');
    await saveStoredTemplate({name, dataUrl, savedAt:new Date().toISOString()});
  }
}

function setTemplateStatus(text){
  const el = document.getElementById('templateStatus');
  if(el) el.textContent = text;
}

function openTemplateDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open('SurveyCounterDB', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredTemplate(){
  const db = await openTemplateDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('settings','readonly');
    const req = tx.objectStore('settings').get('activeTemplate');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveStoredTemplate(value){
  const db = await openTemplateDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('settings','readwrite');
    tx.objectStore('settings').put(value,'activeTemplate');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err=tx.error; db.close(); reject(err); };
  });
}

async function deleteStoredTemplate(){
  const db = await openTemplateDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('settings','readwrite');
    tx.objectStore('settings').delete('activeTemplate');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err=tx.error; db.close(); reject(err); };
  });
}

async function ensurePdfJs(){
  if(pdfjsLib) return pdfjsLib;
  try{
    pdfjsLib = await import(PDFJS_CDN);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    return pdfjsLib;
  }catch(err){
    throw new Error('PDF.js를 불러오지 못했습니다. JPG/PNG 스캔을 사용하거나 PDF.js를 로컬 파일로 연결해주세요.');
  }
}

async function analyzeAll(){
  if(!templatePixels) return alert('기준 설문지를 불러오지 못했습니다.');
  records = [];
  showProgress(true);

  let pages = [];
  for(const file of selectedFiles){
    if(file.type === 'application/pdf'){
      const pdfPages = await pdfToCanvases(file);
      pdfPages.forEach((p,i) => pages.push({file, page:i+1, canvas:p}));
    }else{
      pages.push({file, page:1, canvas:await imageFileToCanvas(file)});
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

    // 신규 수동 입력 필드
    result.programName = '';
    result.comment = '';

    records.push(result);
  }

  updateProgress(pages.length,pages.length,'분석 완료');
  setTimeout(()=>showProgress(false),500);
  renderResults();
  renderReview();
  switchView('review');
}

async function pdfToCanvases(file){
  const lib = await ensurePdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({data}).promise;
  const result = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const base = page.getViewport({scale:1});
    const viewport = page.getViewport({scale:REF_W / base.width});
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
  ctx.fillStyle='white'; ctx.fillRect(0,0,REF_W,REF_H);
  ctx.drawImage(src,0,0,REF_W,REF_H);
  return c;
}

function alignCanvas(src){
  const srcCtx = src.getContext('2d',{willReadFrequently:true});
  const srcData = srcCtx.getImageData(0,0,REF_W,REF_H).data;

  let bestDx=0,bestDy=0,bestScore=Infinity;
  for(let dy=-10;dy<=10;dy+=2){
    for(let dx=-10;dx<=10;dx+=2){
      let score=0,n=0;
      for(let y=120;y<1550;y+=22){
        for(let x=90;x<1150;x+=22){
          const sx=x+dx,sy=y+dy;
          if(sx<0||sy<0||sx>=REF_W||sy>=REF_H) continue;
          const si=(sy*REF_W+sx)*4, ti=(y*REF_W+x)*4;
          const sg=(srcData[si]+srcData[si+1]+srcData[si+2])/3;
          const tg=(templatePixels[ti]+templatePixels[ti+1]+templatePixels[ti+2])/3;
          if(tg<225){score+=Math.abs(sg-tg);n++;}
        }
      }
      const avg=n?score/n:Infinity;
      if(avg<bestScore){bestScore=avg;bestDx=dx;bestDy=dy;}
    }
  }

  if(bestDx===0&&bestDy===0) return src;
  const out=document.createElement('canvas');
  out.width=REF_W;out.height=REF_H;
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
  const gender = genderPick.index>=0 ? REGIONS.gender[genderPick.index].label : '';

  const q2=[], q2Meta=[];
  REGIONS.q2.rows.forEach(row=>{
    const scores=REGIONS.q2.cols.map(col=>addedInkScore(scan,{
      x1:col[0]+8,y1:row[0]+5,x2:col[1]-8,y2:row[1]-5
    }));
    const pick=pickOne(scores,threshold);
    q2.push(pick.index>=0?SCALE_LABELS[pick.index]:'');
    q2Meta.push({scores,pick});
  });

  const q3=[], q3Meta=[];
  REGIONS.q3.rows.forEach(row=>{
    const scores=REGIONS.q3.cols.map(col=>addedInkScore(scan,{
      x1:col[0]+8,y1:row[0]+5,x2:col[1]-8,y2:row[1]-5
    }));
    const pick=pickOne(scores,threshold);
    q3.push(pick.index>=0?SCALE_LABELS[pick.index]:'');
    q3Meta.push({scores,pick});
  });

  const q4Scores=REGIONS.q4.map(r=>addedInkScore(scan,{
    x1:r.x1+5,y1:r.y1+5,x2:r.x2-5,y2:r.y2-5
  }));
  const q4=REGIONS.q4.filter((r,i)=>q4Scores[i]>=threshold).map(r=>r.label);

  const warnings=[];
  if(genderPick.warning) warnings.push('성별');
  q2Meta.forEach((m,i)=>{if(m.pick.warning) warnings.push(`2-${i+1}`);});
  q3Meta.forEach((m,i)=>{if(m.pick.warning) warnings.push(`3-${i+1}`);});

  return {gender,q2,q3,q4,warnings,genderScores,q2Meta,q3Meta,q4Scores};
}

function addedInkScore(scan,r){
  let newDark=0,eligible=0;
  const x1=Math.max(0,Math.floor(r.x1)),y1=Math.max(0,Math.floor(r.y1));
  const x2=Math.min(REF_W,Math.ceil(r.x2)),y2=Math.min(REF_H,Math.ceil(r.y2));
  for(let y=y1;y<y2;y+=2){
    for(let x=x1;x<x2;x+=2){
      const i=(y*REF_W+x)*4;
      const tg=(templatePixels[i]+templatePixels[i+1]+templatePixels[i+2])/3;
      const sg=(scan[i]+scan[i+1]+scan[i+2])/3;
      if(tg>205){
        eligible++;
        if(sg<145&&(tg-sg)>45)newDark++;
      }
    }
  }
  return eligible?(newDark/eligible)*100:0;
}

function pickOne(scores,threshold){
  const order=scores.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
  const top=order[0],second=order[1]||{v:0};
  if(!top||top.v<threshold)return {index:-1,warning:true};
  const close=second.v>=threshold&&(top.v-second.v)<Math.max(.18,top.v*.22);
  return {index:top.i,warning:close};
}

function renderResults(){
  const total=records.length;
  const warningCount=records.filter(r=>r.warnings.length).length;
  const namedCount=records.filter(r=>r.programName.trim()).length;
  const commentCount=records.filter(r=>r.comment.trim()).length;

  document.getElementById('stats').innerHTML=[
    stat('총 설문지',total+'부'),
    stat('프로그램명 입력',namedCount+'부'),
    stat('검토 필요',warningCount+'부'),
    stat('기타 의견 입력',commentCount+'건')
  ].join('');

  const g=countValues(records.map(r=>r.gender),['남','여','']);
  document.getElementById('genderResult').innerHTML=bars([
    ['남',g['남']||0],['여',g['여']||0],['미응답/미판독',g['']||0]
  ],Math.max(1,total));

  renderQ2Integrated();
  renderQ3ByProgram();
  renderQ4();
  renderCommentsByProgram();
}

function renderQ2Integrated(){
  // 2-1~2-4를 모두 한 배열로 펼쳐 통합 집계
  const all=records.flatMap(r=>r.q2);
  const counts=countValues(all,[...SCALE_LABELS,'']);
  const answered=SCALE_LABELS.reduce((sum,k)=>sum+(counts[k]||0),0);
  const totalPossible=records.length*4;

  document.getElementById('q2IntegratedResult').innerHTML = `
    <div class="stats" style="margin-bottom:14px">
      ${stat('유효 응답 수',answered+'건')}
      ${stat('전체 가능 응답',totalPossible+'건')}
      ${stat('미응답/미판독',(counts['']||0)+'건')}
      ${stat('긍정 응답률',answered?(((counts['매우 만족']||0)+(counts['만족']||0))/answered*100).toFixed(1)+'%':'-')}
    </div>
    ${bars(SCALE_LABELS.map(k=>[k,counts[k]||0]),Math.max(1,answered))}
  `;
}

function renderQ3ByProgram(){
  const root=document.getElementById('q3ByProgramResult');
  const groups=groupRecordsByProgram();

  if(!Object.keys(groups).length){
    root.innerHTML='<div class="empty-box">응답 검토 화면에서 프로그램명을 입력하면 여기에 프로그램별 통계가 표시됩니다.</div>';
    return;
  }

  root.innerHTML=Object.entries(groups).map(([program,items])=>{
    return `
      <div class="program-block">
        <div class="program-title">
          <h3>${escapeHtml(program)}</h3>
          <span class="pill">${items.length}부</span>
        </div>
        ${likertTable(
          QUESTION_LABELS.q3,
          QUESTION_LABELS.q3.map((_,i)=>items.map(r=>r.q3[i]))
        )}
      </div>
    `;
  }).join('');
}

function renderQ4(){
  const counts=Object.fromEntries(QUESTION_LABELS.q4.map(x=>[x,0]));
  records.forEach(r=>r.q4.forEach(v=>{if(v in counts)counts[v]++;}));
  document.getElementById('q4Result').innerHTML=bars(
    QUESTION_LABELS.q4.map(v=>[v,counts[v]]),
    Math.max(1,records.length)
  );
}

function renderCommentsByProgram(){
  const root=document.getElementById('commentsByProgramResult');
  const groups={};

  records.forEach(r=>{
    const comment=r.comment.trim();
    if(!comment)return;
    const program=r.programName.trim()||'프로그램명 미입력';
    if(!groups[program])groups[program]=[];
    groups[program].push(comment);
  });

  if(!Object.keys(groups).length){
    root.innerHTML='<div class="empty-box">응답 검토 화면에서 기타 의견을 입력하면 여기에 프로그램별로 모아 표시됩니다.</div>';
    return;
  }

  root.innerHTML=Object.entries(groups).map(([program,comments])=>`
    <div class="program-block">
      <div class="program-title">
        <h3>${escapeHtml(program)}</h3>
        <span class="pill">${comments.length}건</span>
      </div>
      <div class="comment-list">
        ${comments.map((c,i)=>`<div class="comment-item"><strong>${i+1}.</strong> ${escapeHtml(c)}</div>`).join('')}
      </div>
    </div>
  `).join('');
}

function groupRecordsByProgram(){
  const groups={};
  records.forEach(r=>{
    const name=r.programName.trim();
    if(!name)return;
    if(!groups[name])groups[name]=[];
    groups[name].push(r);
  });
  return groups;
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

      <div class="review-meta">
        <label>
          프로그램명
          <input type="text"
            placeholder="예: 전통 비즈 뒤꽂이 만들기"
            value="${escapeAttr(r.programName)}"
            oninput="updateTextField('${r.id}','programName',this.value)">
        </label>

        <label>
          기타 의견 / 건의사항
          <textarea
            placeholder="설문지 5번 자유의견을 보고 직접 입력하세요."
            oninput="updateTextField('${r.id}','comment',this.value)">${escapeHtml(r.comment)}</textarea>
        </label>
      </div>

      <div class="review-grid">
        ${selectField(r.id,'gender','성별',r.gender,['','남','여'])}
        ${r.q2.map((v,i)=>selectField(r.id,`q2.${i}`,`2-${i+1}. ${shortLabel(QUESTION_LABELS.q2[i])}`,v,['',...SCALE_LABELS])).join('')}
        ${r.q3.map((v,i)=>selectField(r.id,`q3.${i}`,`3-${i+1}. ${shortLabel(QUESTION_LABELS.q3[i])}`,v,['',...SCALE_LABELS])).join('')}
        <label>
          4. 희망 프로그램
          <div class="q4-checks">
            ${QUESTION_LABELS.q4.map(v=>`
              <label><input type="checkbox" ${r.q4.includes(v)?'checked':''}
                onchange="updateQ4('${r.id}','${v}',this.checked)"> ${v}</label>
            `).join('')}
          </div>
        </label>
      </div>
    </article>
  `).join('');
}

function updateTextField(id,key,value){
  const r=records.find(x=>x.id===id);if(!r)return;
  r[key]=value;
  renderResults();
}
window.updateTextField=updateTextField;

function selectField(id,path,label,value,options){
  return `<label>${escapeHtml(label)}
    <select onchange="updateAnswer('${id}','${path}',this.value)">
      ${options.map(o=>`<option value="${escapeAttr(o)}" ${o===value?'selected':''}>${escapeHtml(o||'미응답/미판독')}</option>`).join('')}
    </select>
  </label>`;
}

function updateAnswer(id,path,value){
  const r=records.find(x=>x.id===id);if(!r)return;
  if(path==='gender')r.gender=value;
  else{
    const [key,idx]=path.split('.');
    r[key][Number(idx)]=value;
  }
  r.warnings=[];
  renderResults();
  renderReview();
}
window.updateAnswer=updateAnswer;

function updateQ4(id,value,checked){
  const r=records.find(x=>x.id===id);if(!r)return;
  if(checked&&!r.q4.includes(value))r.q4.push(value);
  if(!checked)r.q4=r.q4.filter(v=>v!==value);
  renderResults();
}
window.updateQ4=updateQ4;

function showOriginal(id){
  const r=records.find(x=>x.id===id);if(!r)return;
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
  const head='<tr><th>문항</th>'+SCALE_LABELS.map(x=>`<th>${x}</th>`).join('')+'<th>미응답/미판독</th><th>응답계</th></tr>';
  const rows=labels.map((label,i)=>{
    const counts=countValues(answers[i],[...SCALE_LABELS,'']);
    const answered=SCALE_LABELS.reduce((a,k)=>a+(counts[k]||0),0);
    return `<tr>
      <td>${escapeHtml(label)}</td>
      ${SCALE_LABELS.map(k=>`<td>${counts[k]||0}</td>`).join('')}
      <td>${counts['']||0}</td>
      <td class="total">${answered}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function bars(items,total){
  const max=Math.max(1,...items.map(x=>x[1]));
  return items.map(([label,count])=>{
    const pct=total?(count/total*100):0;
    return `<div class="bar-row">
      <span>${escapeHtml(label)}</span>
      <div class="bar"><span style="width:${(count/max*100).toFixed(1)}%"></span></div>
      <strong>${count} (${pct.toFixed(1)}%)</strong>
    </div>`;
  }).join('');
}

function countValues(values,keys){
  const out=Object.fromEntries(keys.map(k=>[k,0]));
  values.forEach(v=>{if(v in out)out[v]++;else out[v]=1;});
  return out;
}

function downloadCSV(){
  if(!records.length)return;
  const headers=[
    '파일명','페이지','프로그램명','성별',
    ...QUESTION_LABELS.q2.map((_,i)=>`2-${i+1}`),
    ...QUESTION_LABELS.q3.map((_,i)=>`3-${i+1}`),
    '희망프로그램','기타의견','검토필요'
  ];
  const rows=records.map(r=>[
    r.fileName,r.page,r.programName,r.gender,
    ...r.q2,...r.q3,
    r.q4.join('|'),r.comment,r.warnings.join('|')
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
  document.getElementById('pageTitle').textContent={
    upload:'설문 업로드',result:'집계 결과',review:'응답 검토'
  }[name];
  if(name==='result')renderResults();
}
function resetAll(){
  selectedFiles=[];records=[];
  document.getElementById('fileInput').value='';
  setFiles([]);
  document.getElementById('stats').innerHTML='';
  document.getElementById('reviewList').innerHTML='';
  switchView('upload');
}
function stat(label,value){return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;}
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
function escapeAttr(s=''){return escapeHtml(s);}
