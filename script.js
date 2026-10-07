const REF_W=SurveyEngine.W,REF_H=SurveyEngine.H;
let selectedFiles=[],records=[],templateCanvas=null,schema=null,pdfjsLib=null,busy=false,templateName='',draft=null,selectedRegion=null;
const $=id=>document.getElementById(id);
let comparisonState=null,comparisonRequest=0;
const SCALE_LABELS=['매우 만족','만족','보통','불만족','매우 불만족'];
document.addEventListener('DOMContentLoaded',async()=>{bindUI();try{await loadTemplate();}catch(e){setTemplateStatus('원본 PDF 등록 필요');$('schemaSummary').textContent=e.message;}});
function bindUI(){
 $('fileInput').onchange=e=>setFiles([...e.target.files]);
 for(const n of ['dragenter','dragover'])$('dropZone').addEventListener(n,e=>{e.preventDefault();$('dropZone').classList.add('drag');});
 for(const n of ['dragleave','drop'])$('dropZone').addEventListener(n,e=>{e.preventDefault();$('dropZone').classList.remove('drag');});
 $('dropZone').addEventListener('drop',e=>setFiles([...e.dataTransfer.files]));
 $('threshold').oninput=e=>$('thresholdText').textContent=Number(e.target.value).toFixed(2)+'%';
 $('analyzeBtn').onclick=analyzeAll;$('resetBtn').onclick=resetAll;$('downloadCsvBtn').onclick=downloadCSV;$('reviewFilter').onchange=renderReview;
 $('templateFileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;busy=true;updateReady();setTemplateStatus('처리 중');try{
   let next;if(file.type==='application/pdf')next=await SurveyEngine.parsePdf(file,await ensurePdfJs());
   else next={canvas:SurveyEngine.normalize(await imageFileToCanvas(file)),schema:{version:2,questions:[],confirmed:false}};
   // Commit a template only after parsing succeeds. Existing answers cannot follow a different schema.
   templateCanvas=next.canvas;schema=next.schema;templateName=file.name;records=[];
   displayTemplate();renderResults();renderReview();openEditor();setTemplateStatus('문항 확인 필요');
 }catch(err){alert(err.message);setTemplateStatus(schema?.confirmed?'사용 가능':'원본 PDF 등록 필요');}finally{busy=false;updateReady();e.target.value='';}};
 $('resetTemplateBtn').onclick=async()=>{if(busy)return;await dbOperation('delete');records=[];await loadDefaultTemplate();renderResults();renderReview();};
 $('editSchemaBtn').onclick=()=>{if(!templateCanvas)return alert('원본 양식을 먼저 등록해주세요.');openEditor();};
 $('closeModal').onclick=closeModal;$('imageModal').onclick=e=>{if(e.target.id==='imageModal')closeModal();};
 document.querySelectorAll('[data-compare-mode]').forEach(b=>b.onclick=()=>{if(!comparisonState)return;comparisonState.mode=b.dataset.compareMode;drawComparison();});
 $('compareOpacity').oninput=drawComparison;$('compareQuestion').onchange=drawComparison;
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
 document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
}
function validFile(f){return f.type==='application/pdf'||/^image\/(png|jpeg)$/.test(f.type);}
function setFiles(files){if(busy)return;selectedFiles=files.filter(validFile);$('fileCount').textContent=selectedFiles.length+'개';$('fileList').innerHTML=selectedFiles.length?selectedFiles.map(f=>`<div class="file-item"><span>${escapeHtml(f.name)}</span><span>${formatBytes(f.size)}</span></div>`).join(''):'아직 선택된 파일이 없습니다.';updateReady();}
function updateReady(){ $('analyzeBtn').disabled=busy||!selectedFiles.length||!schema?.confirmed||!templateCanvas; $('templateFileInput').disabled=busy;$('resetTemplateBtn').disabled=busy;$('resetBtn').disabled=busy;$('editSchemaBtn').disabled=busy;}
async function ensurePdfJs(){if(!pdfjsLib){pdfjsLib=await import('./vendor/pdf.mjs');pdfjsLib.GlobalWorkerOptions.workerSrc='./vendor/pdf.worker.mjs';}return pdfjsLib;}
async function dbOperation(op,value){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('SurveyCounterDB',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return new Promise((resolve,reject)=>{const t=db.transaction('settings',op==='get'?'readonly':'readwrite'),s=t.objectStore('settings');let result;
 const r=op==='get'?s.get('activeTemplate'):op==='delete'?s.delete('activeTemplate'):s.put(value,'activeTemplate');r.onsuccess=()=>result=r.result;t.oncomplete=()=>{db.close();resolve(result);};t.onerror=()=>{db.close();reject(t.error);};});
}
async function loadTemplate(){const saved=await dbOperation('get');if(saved?.schema?.version===2){templateCanvas=await imageURLToCanvas(saved.dataUrl);schema=saved.schema;templateName=saved.name;displayTemplate();setTemplateStatus(schema.confirmed?'사용 가능':'문항 확인 필요');updateReady();}else await loadDefaultTemplate();}
async function loadDefaultTemplate(){
 // Legacy raster templates contain no text geometry: require registration rather than silently reusing old fixed coordinates.
 templateCanvas=await imageURLToCanvas('template.png');templateName='기본 이미지 양식';schema={version:2,questions:[],confirmed:false};displayTemplate();$('schemaSummary').textContent='원본 PDF를 등록하거나 문항·응답 영역을 직접 설정하세요.';setTemplateStatus('원본 PDF 등록 필요');updateReady();
}
async function imageURLToCanvas(url){const img=await loadImage(url),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return SurveyEngine.normalize(c);}
function displayTemplate(){ $('templateName').value=templateName;$('templatePreview').src=templateCanvas.toDataURL('image/jpeg',.85);$('templatePreviewWrap').hidden=false;$('schemaSummary').textContent=`${schema.questions.length}개 문항 · ${schema.confirmed?'확인 완료':'확인 필요'}`;}
function setTemplateStatus(text){$('templateStatus').textContent=text;$('templateStatus').className='status-badge '+(text.includes('사용')?'success':text.includes('처리')?'loading':'error');}
function openEditor(){draft=structuredClone(schema);selectedRegion=null;renderEditor();}
function renderEditor(){
 const root=$('schemaEditor');root.hidden=false;
 root.innerHTML=`<p class="card-note">문항명·응답 방식·선택지를 확인하세요. 영역 버튼을 선택하고 아래 원본에서 드래그하면 위치를 수정할 수 있습니다. 양식 저장 시 이전 집계는 초기화됩니다. 프로그램마다 문항 내용이 다르면 해당 원본으로 별도 분석하세요.</p>
 <div class="schema-questions">${draft.questions.map((q,i)=>`<div class="schema-question"><div class="schema-row"><input aria-label="문항명" data-q="${i}" data-field="label" value="${escapeAttr(q.label)}"><select aria-label="응답 방식" data-q="${i}" data-field="type">${[['single','단일 선택'],['multiple','복수 선택'],['text','자유 의견']].map(([v,l])=>`<option value="${v}" ${v===q.type?'selected':''}>${l}</option>`).join('')}</select><button data-remove="${i}" type="button">삭제</button></div>${q.typeNeedsReview?'<p class="type-note">복수응답 여부가 원본에 명시되지 않았습니다. 응답 방식을 확인해주세요.</p>':''}${q.type!=='text'?`<label>선택지 (한 줄에 하나)<textarea data-q="${i}" data-field="options">${escapeHtml(q.options.map(o=>o.label).join('\n'))}</textarea></label><div class="region-buttons">${q.options.map((o,j)=>`<button type="button" data-region="${i},${j}" class="${selectedRegion?.[0]===i&&selectedRegion?.[1]===j?'selected':''}">${escapeHtml(o.label)} 영역 ${o.rect?'✓':'미설정'}</button>`).join('')}</div>`:'<p class="card-note">필기 의견은 원본을 보고 직접 입력합니다.</p>'}</div>`).join('')}</div>
 <div class="button-row"><button id="addQuestion" class="secondary-btn">문항 추가</button><button id="confirmSchema" class="primary-btn">이 문항 구조로 저장</button><button id="cancelSchema" class="secondary-btn">취소</button></div><p id="regionHelp" class="card-note">${selectedRegion?'선택한 응답 영역을 원본에서 드래그하세요.':'영역 버튼을 누르면 선택지 위치를 표시합니다.'}</p><canvas id="regionCanvas" width="1240" height="1753"></canvas>`;
 root.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{const q=draft.questions[Number(el.dataset.q)],f=el.dataset.field;if(f==='options'){q.options=el.value.split('\n').map(l=>l.trim()).filter(Boolean).map((label,i)=>({label,rect:q.options[i]?.rect||null,parts:q.options[i]?.parts||null}));}else q[f]=el.value;if(f==='type')renderEditor();else if(f==='options'){const box=el.closest('.schema-question').querySelector('.region-buttons');box.innerHTML=q.options.map((o,j)=>`<button type="button" data-region="${el.dataset.q},${j}">${escapeHtml(o.label)} 영역 ${o.rect?'✓':'미설정'}</button>`).join('');box.querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{selectedRegion=b.dataset.region.split(',').map(Number);renderEditor();});}});
 root.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{draft.questions.splice(Number(el.dataset.remove),1);selectedRegion=null;renderEditor();});
 root.querySelectorAll('[data-region]').forEach(el=>el.onclick=()=>{selectedRegion=el.dataset.region.split(',').map(Number);renderEditor();});
 $('addQuestion').onclick=()=>{draft.questions.push({id:'q_'+crypto.randomUUID(),section:'추가',label:'새 문항',type:'single',options:[]});renderEditor();};
 $('cancelSchema').onclick=()=>{root.hidden=true;draft=null;};
 $('confirmSchema').onclick=async()=>{
  if(!draft.questions.length)return alert('문항을 하나 이상 등록해주세요.');
  for(const q of draft.questions){if(!q.label.trim())return alert('문항명을 입력해주세요.');if(q.type!=='text'&&(!q.options.length||new Set(q.options.map(o=>o.label)).size!==q.options.length||q.options.some(o=>!o.rect||o.rect.x2-o.rect.x1<5||o.rect.y2-o.rect.y1<5)))return alert('선택지 이름과 응답 영역을 모두 확인해주세요.');}
  const next=structuredClone(draft);next.confirmed=true;next.questions.forEach(q=>delete q.typeNeedsReview);
  try{await dbOperation('put',{name:templateName,schema:next,dataUrl:templateCanvas.toDataURL('image/png')});schema=next;records=[];root.hidden=true;displayTemplate();setTemplateStatus('사용 가능');updateReady();renderResults();renderReview();}catch(e){alert('양식 저장 실패: '+e.message);}
 };
 const c=$('regionCanvas'),ctx=c.getContext('2d');ctx.drawImage(templateCanvas,0,0);
 if(selectedRegion){const o=draft.questions[selectedRegion[0]]?.options[selectedRegion[1]];if(o?.rect){const r=o.rect;ctx.strokeStyle='#7246ff';ctx.lineWidth=4;ctx.strokeRect(r.x1,r.y1,r.x2-r.x1,r.y2-r.y1);}}
 let start=null;const point=e=>{const b=c.getBoundingClientRect();return [Math.max(0,Math.min(REF_W,(e.clientX-b.left)*REF_W/b.width)),Math.max(0,Math.min(REF_H,(e.clientY-b.top)*REF_H/b.height))];};
 c.onpointerdown=e=>{if(!selectedRegion)return;start=point(e);c.setPointerCapture(e.pointerId);e.preventDefault();};
 c.onpointermove=e=>{if(!start)return;const end=point(e);ctx.drawImage(templateCanvas,0,0);ctx.strokeStyle='#7246ff';ctx.lineWidth=4;ctx.strokeRect(start[0],start[1],end[0]-start[0],end[1]-start[1]);};
 c.onpointerup=e=>{if(!start)return;const end=point(e);delete draft.questions[selectedRegion[0]].options[selectedRegion[1]].parts;draft.questions[selectedRegion[0]].options[selectedRegion[1]].rect={x1:Math.min(start[0],end[0]),y1:Math.min(start[1],end[1]),x2:Math.max(start[0],end[0]),y2:Math.max(start[1],end[1])};start=null;renderEditor();};
}
async function pdfToCanvases(file){const lib=await ensurePdfJs(),pdf=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),wasmUrl:"./vendor/wasm/"}).promise,result=[];try{for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),v=page.getViewport({scale:1}),view=page.getViewport({scale:REF_W/v.width}),c=document.createElement('canvas');c.width=Math.round(view.width);c.height=Math.round(view.height);await page.render({canvasContext:c.getContext('2d'),viewport:view}).promise;result.push(c);}return result;}finally{await pdf.destroy();}}
async function imageFileToCanvas(file){const url=URL.createObjectURL(file);try{return await imageURLToCanvas(url);}finally{URL.revokeObjectURL(url);}}
async function analyzeAll(){
 if(busy||!schema?.confirmed)return;busy=true;updateReady();records=[];showProgress(true);let done=0;
 try{
  for(const file of selectedFiles){updateProgress(done,0,file.name+' 렌더링 중');const pages=file.type==='application/pdf'?await pdfToCanvases(file):[await imageFileToCanvas(file)];
   for(let i=0;i<pages.length;i++){updateProgress(i,pages.length,`${file.name} · ${i+1}/${pages.length}페이지 분석 중`);await nextFrame();const original=SurveyEngine.normalize(pages[i]),aligned=SurveyEngine.align(original,templateCanvas,schema),r=SurveyEngine.read(aligned.canvas,templateCanvas,schema,Number($('threshold').value),aligned.meta,true);
    records.push({...r,id:crypto.randomUUID(),fileName:file.name,page:i+1,programName:file.name.replace(/\.pdf$/i,'').replace(/^만족도조사\((.*)\)$/,'$1'),alignment:aligned.meta,reviewed:false,imageDataUrl:original.toDataURL('image/jpeg',.8),alignedDataUrl:aligned.canvas.toDataURL('image/png')});done++;pages[i]=null;
   }
  }
  updateProgress(1,1,`분석 완료 · ${done}부`);renderResults();renderReview();switchView('review');
 }catch(e){console.error(e);alert('분석 중 오류: '+e.message+'\n완료한 응답은 보존됩니다.');renderResults();renderReview();}
 finally{busy=false;updateReady();showProgress(false);}
}
function recordIsConfirmed(r){return r.reviewed===true||r.warnings.length===0;}
function confirmedRecords(){return records.filter(recordIsConfirmed);}
function renderResults(){
 const source=confirmedRecords();$('stats').innerHTML=[stat('총 설문지',records.length+'부'),stat('유효 집계',source.length+'부'),stat('검토 대기',(records.length-source.length)+'부')].join('');
 if(!schema){$('questionResults').innerHTML='';return;}
 const groups={};for(const r of source){const key=r.programName||'프로그램명 미입력';(groups[key]??=[]).push(r);}
 $('questionResults').innerHTML=schema.questions.map(q=>`<section class="result-card"><div class="result-card-head"><div><h3>${escapeHtml(q.label)}</h3></div><p>${q.type==='multiple'?'복수응답 · 비율 분모는 해당 프로그램 유효 설문 수':'문항별 개별 집계'}</p></div>${Object.entries(groups).map(([program,items])=>{
  if(q.type==='text'){const comments=items.map(r=>r.answers[q.id]).filter(Boolean);return `<div class="program-block"><h4>${escapeHtml(program)}</h4>${comments.length?comments.map(c=>`<div class="comment-item">${escapeHtml(c)}</div>`).join(''):'입력된 의견이 없습니다.'}</div>`;}
  const counts=q.options.map(o=>[o.label,items.filter(r=>Array.isArray(r.answers[q.id])?r.answers[q.id].includes(o.label):r.answers[q.id]===o.label).length]);
  const missing=items.filter(r=>!r.answers[q.id]||Array.isArray(r.answers[q.id])&&!r.answers[q.id].length).length;
  const countCells=counts.map(([l,n])=>`<td>${n} (${(n/items.length*100).toFixed(1)}%)</td>`).join('');
  return `<div class="program-block"><h4>${escapeHtml(program)} · ${items.length}부</h4><div class="table-wrap"><table><thead><tr>${counts.map(([l])=>`<th>${escapeHtml(l)}</th>`).join('')}<th>미응답</th></tr></thead><tbody><tr>${countCells}<td>${missing}</td></tr></tbody></table></div>${bars(counts,items.length)}</div>`;
 }).join('')||'<div class="empty-box">검토 완료된 응답이 없습니다.</div>'}</section>`).join('');
}
function renderReview(){
 const root=$('reviewList'),items=records.filter(r=>$('reviewFilter').value==='all'||!recordIsConfirmed(r));
 root.innerHTML=items.length?items.map(r=>`<article class="review-card ${recordIsConfirmed(r)?'':'warning'}"><div class="review-head"><div><strong>${escapeHtml(r.fileName)} · ${r.page}p</strong><div class="help">${r.reviewed?'검토 완료':r.warnings.length?'검토 대상: '+escapeHtml(r.warnings.join(', ')):'자동 판독 완료'} · 회전 ${r.alignment.angle.toFixed(2)}° · 정렬 오차 ${r.alignment.score.toFixed(2)}</div></div><div><button class="original-btn" data-compare="${r.id}">원본과 겹쳐 비교</button><button class="original-btn" data-original="${r.id}">원본 보기</button><button class="original-btn" data-aligned="${r.id}">정렬본 보기</button><button class="original-btn" data-confirm="${r.id}">${r.reviewed?'검토 완료':'검토 완료로 확정'}</button></div></div><label>프로그램명<input data-id="${r.id}" data-program value="${escapeAttr(r.programName)}"></label><div class="review-grid">${schema.questions.map(q=>{
  const val=r.answers[q.id];const attr=`data-id="${r.id}" data-question="${q.id}"`;
  if(q.type==='text')return `<label>${escapeHtml(q.label)}<textarea ${attr} placeholder="원본 필기를 보고 직접 입력해주세요.">${escapeHtml(val||'')}</textarea></label>`;
  if(q.type==='multiple')return `<div><span>${escapeHtml(q.label)}</span><div class="q4-checks">${q.options.map(o=>`<label><input type="checkbox" ${attr} value="${escapeAttr(o.label)}" ${val?.includes(o.label)?'checked':''}>${escapeHtml(o.label)}</label>`).join('')}</div></div>`;
  return `<label>${escapeHtml(q.label)}<select ${attr}><option value="">미응답 / 미판독</option>${q.options.map(o=>`<option value="${escapeAttr(o.label)}" ${val===o.label?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
 }).join('')}</div></article>`).join(''):'<div class="empty-box">표시할 응답이 없습니다.</div>';
 root.querySelectorAll('[data-original],[data-aligned],[data-compare]').forEach(el=>el.onclick=()=>openComparison(el.dataset.original||el.dataset.aligned||el.dataset.compare,el.dataset.original?'original':el.dataset.aligned?'aligned':'overlay'));
 root.querySelectorAll('[data-confirm]').forEach(el=>el.onclick=()=>{records.find(r=>r.id===el.dataset.confirm).reviewed=true;renderResults();renderReview();});
 root.querySelectorAll('[data-question],[data-program]').forEach(el=>el.onchange=()=>{const r=records.find(r=>r.id===el.dataset.id);if(el.hasAttribute('data-program'))r.programName=el.value;else{
  const q=schema.questions.find(q=>q.id===el.dataset.question);if(q.type==='multiple'){const set=new Set(r.answers[q.id]);el.checked?set.add(el.value):set.delete(el.value);r.answers[q.id]=[...set];}else r.answers[q.id]=el.value;
  if(q.type!=='text'){r.reviewed=false;if(!r.warnings.includes('수동 수정'))r.warnings.push('수동 수정');}
 }renderResults();if(!el.hasAttribute('data-program')&&el.tagName!=='TEXTAREA')renderReview();});
}
async function openComparison(id,mode='overlay'){
 const r=records.find(r=>r.id===id);if(!r)return;const request=++comparisonRequest;
 $('modalTitle').textContent=r.fileName+' · '+r.page+'p';$('imageModal').classList.remove('hidden');
 $('comparisonInfo').textContent='비교 이미지 준비 중…';$('comparisonCanvas').hidden=true;comparisonState=null;
 try{
  const [original,aligned,difference]=await Promise.all([loadImage(r.imageDataUrl),loadImage(r.alignedDataUrl),r.differenceDataUrl?loadImage(r.differenceDataUrl):Promise.resolve(null)]);
  if(request!==comparisonRequest)return;
  comparisonState={r,mode,original,aligned,difference};
  $('compareQuestion').innerHTML='<option value="">전체 설문</option>'+schema.questions.filter(q=>q.type!=='text').map(q=>`<option value="${escapeAttr(q.id)}">${escapeHtml(q.label)}</option>`).join('');
  $('compareOpacity').value='50';$('comparisonCanvas').hidden=false;drawComparison();
 }catch(e){if(request===comparisonRequest)$('comparisonInfo').textContent='비교 이미지를 불러오지 못했습니다.';}
}
function drawComparison(){
 if(!comparisonState)return;
 const {r,mode,original,aligned,difference}=comparisonState,q=schema.questions.find(q=>q.id===$('compareQuestion').value);
 const opacity=Number($('compareOpacity').value)/100;
 $('compareOpacityText').textContent=Math.round(opacity*100)+'%';$('compareOpacityWrap').hidden=mode!=='overlay';
 document.querySelectorAll('[data-compare-mode]').forEach(b=>{const on=b.dataset.compareMode===mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
 let rect={x1:0,y1:0,x2:REF_W,y2:REF_H};
 if(q?.options.length){const rs=q.options.map(o=>o.rect);rect={x1:Math.max(0,Math.min(...rs.map(r=>r.x1))-30),y1:Math.max(0,Math.min(...rs.map(r=>r.y1))-45),x2:Math.min(REF_W,Math.max(...rs.map(r=>r.x2))+30),y2:Math.min(REF_H,Math.max(...rs.map(r=>r.y2))+45)};}
 const c=$('comparisonCanvas');c.width=Math.ceil(rect.x2-rect.x1);c.height=Math.ceil(rect.y2-rect.y1);const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.translate(-rect.x1,-rect.y1);
 if(mode==='original')ctx.drawImage(original,0,0,REF_W,REF_H);
 else if(mode==='reference')ctx.drawImage(templateCanvas,0,0);
 else if(mode==='aligned')ctx.drawImage(aligned,0,0,REF_W,REF_H);
 else if(mode==='overlay'){ctx.drawImage(templateCanvas,0,0);ctx.globalAlpha=opacity;ctx.drawImage(aligned,0,0,REF_W,REF_H);ctx.globalAlpha=1;}
 else {ctx.drawImage(templateCanvas,0,0);if(difference)ctx.drawImage(difference,0,0,REF_W,REF_H);}
 if(mode!=='original'&&mode!=='reference')for(const question of q?[q]:schema.questions){
  const warning=r.warnings.some(w=>w===question.id||w.startsWith(question.id+' '));
  for(const o of question.options){const box=o.rect,value=r.answers[question.id],selected=Array.isArray(value)?value.includes(o.label):value===o.label;
   ctx.strokeStyle=warning?'#d97706':selected?'#059669':'#7870b9';ctx.lineWidth=q?2:1;ctx.strokeRect(box.x1,box.y1,box.x2-box.x1,box.y2-box.y1);
  }
 }
 const answer=q?r.answers[q.id]:null,quality=q?r.localQuality?.[q.id]:null;
 const evidence=q?' · '+q.options.map((o,i)=>o.label+': '+(r.scores[q.id]?.[i]??0).toFixed(2)+'%').join(' / '):'';
 $('comparisonInfo').textContent=`회전 ${r.alignment.angle.toFixed(2)}° · 이동 X ${r.alignment.dx.toFixed(1)} / Y ${r.alignment.dy.toFixed(1)}px · 크기 X ${(r.alignment.scaleX*100).toFixed(1)} / Y ${(r.alignment.scaleY*100).toFixed(1)}%`+(q?' · 판독: '+(Array.isArray(answer)?answer.join(', '):answer||'미응답 / 미판독'):'')+(quality?' · 문항 정렬 오차 '+quality.error.toFixed(2)+'px':'')+evidence;
 $('comparisonLegend').textContent=mode==='difference'?'빨강: 선택지 영역에서 추출한 추가 잉크 후보 · 초록 테두리: 판독한 답변 · 주황: 검토 필요. 빨간 표시가 모두 확정 응답인 것은 아닙니다.':mode==='overlay'?'스캔본 비중을 바꾸며 표선이 겹치는지 확인하세요. 초록 테두리: 판독한 답변 · 주황: 검토 필요.':'문항을 선택하면 답변 영역을 확대합니다.';
 if(mode==='difference'&&!difference)$('comparisonLegend').textContent='검출 표시가 저장되지 않은 응답입니다. 다시 분석해주세요.';
}
function closeModal(){comparisonRequest++;comparisonState=null;$('imageModal').classList.add('hidden');const c=$('comparisonCanvas');c.width=1;c.height=1;}
function resetAll(){if(busy)return;records=[];selectedFiles=[];$('fileInput').value='';setFiles([]);renderResults();renderReview();switchView('upload');}
function downloadCSV(){if(!records.length)return;const headers=['파일명','페이지','프로그램명',...schema.questions.map(q=>q.label),'집계상태','검토사유','정렬각도','정렬오차'];const rows=records.map(r=>[r.fileName,r.page,r.programName,...schema.questions.map(q=>Array.isArray(r.answers[q.id])?r.answers[q.id].join('|'):r.answers[q.id]),recordIsConfirmed(r)?'유효':'검토 대기',r.warnings.join('|'),r.alignment.angle,r.alignment.score]);const csv='\uFEFF'+[headers,...rows].map(row=>row.map(v=>csvCell(/^[=+@-]/.test(String(v))?"'"+v:v)).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='만족도조사_문항별집계.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
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

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelector(`.nav[data-view="${name}"]`).classList.add('active');
  document.getElementById('pageTitle').innerHTML={
    upload:'만족도 조사 결과를<br>더 빠르고 정확하게',
    result:'분석 결과를<br>한눈에 확인하세요',
    review:'자동 판독 결과를<br>확인하고 보정하세요'
  }[name];
  if(name==='result')renderResults();
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
